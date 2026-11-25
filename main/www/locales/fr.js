// translation-source: eceea7ddd6ed641798b2f04b3048352f8ee2c044ab186c3c4c20fc20c05eef5b
I18N.fr = localeValues([
  /* sys.nodata */ "Aucune donnée",
  /* sys.unreachable */ "Injoignable",
  /* sys.mb_only */ "X10A hors ligne — relevés Modbus",
  /* mode.stop */ "Arrêt",
  /* mode.heat */ "Chauffage",
  /* mode.cool */ "Rafraîchissement",
  /* mode.space */ "Mode locaux",
  /* mode.dhw */ "Eau chaude",
  /* mode.heat_dhw */ "Chauffage + eau chaude",
  /* mode.cool_dhw */ "Rafraîchissement + eau chaude",
  /* mode.space_dhw */ "Locaux + eau chaude",
  /* sys.unreachable_sub */ "Impossible de joindre l’appareil — nouvelle tentative…",
  /* sys.waiting */ "En attente de la pompe à chaleur…",
  /* sys.operating */ "En fonctionnement",
  /* sys.standby */ "En veille — à l’arrêt",
  /* sys.defrosting */ "Dégivrage",
  /* sys.circulating */ "Circulation — compresseur arrêté",
  /* sys.cool_mode */ "Mode rafraîchissement",
  /* sys.residual_circulating */ "Circulation de chaleur résiduelle — aucune puissance frigorifique",
  /* sys.bsh_active */ "Résistance électrique du ballon active",
  /* sys.disinfecting */ "Désinfection du ballon active",
  /* sys.online */ "En ligne",
  /* sys.fault */ "Défaut",
  /* sys.warning */ "Avertissement",
  /* sys.fault_line */ (c) => "Défaut · " + c + " — vérifiez le code de défaut Daikin.",
  /* sys.warning_line */ (c) => "Avertissement · " + c + " — vérifiez la pompe à chaleur.",
  /* sys.polled */ (s) => `Interrogé il y a ${s} s`,
  /* config.unreadable_title */ "Réglages des services illisibles",
  /* config.unreadable_meta */ "Cette version n’a pas pu lire les réglages des services enregistrés. Elle utilise des réglages de repli et n’a pas remplacé la copie conservée. Un micrologiciel compatible plus récent pourrait la restaurer. Un enregistrement réussi des réglages des services la remplace ; enregistrer seulement les broches X10A ou le protocole ne la remplace pas.",
  /* recovery.title */ "Mode de récupération",
  /* recovery.meta_heap */ "L’appareil a manqué de mémoire à plusieurs reprises et a redémarré. Il fonctionne maintenant avec la connexion à la pompe à chaleur et MQTT désactivés, afin que l’interface web reste accessible. La configuration est très probablement correcte — installez une version plus récente du micrologiciel dans Paramètres. Une mise hors tension puis sous tension relance la pile complète.",
  /* recovery.meta */ "L’appareil a redémarré à plusieurs reprises et est passé en mode de récupération. La communication avec la pompe à chaleur et MQTT est suspendue. Vérifiez la configuration — en particulier les broches RX/TX de la carte Protocole dans Paramètres — puis redémarrez l’appareil.",
  /* rollback.title */ "Échec de la modification WiFi — ancienne configuration restaurée",
  /* rollback.meta */ (back) => `L’appareil n’a pas pu se connecter avec les nouveaux paramètres WiFi. Il a restauré le réseau précédent${back} et redémarré. Vérifiez le nom du réseau et le mot de passe dans Paramètres → Connexions, puis réessayez.`,
  /* crash.title_fault */ "L’appareil a redémarré après une erreur",
  /* crash.title_orphan */ "Un rapport de plantage d’un redémarrage antérieur est en attente",
  /* crash.reset */ "Réinitialisation",
  /* crash.task */ "tâche",
  /* crash.fw */ "fw",
  /* crash.elf */ "elf",
  /* crash.corrupted */ "corrompu",
  /* crash.stored_dump */ "Rapport de plantage conservé",
  /* crash.stored_hint */ "L’âge du rapport et son lien avec ce redémarrage sont inconnus.",
  /* crash.backtrace */ "Pile d’appels",
  /* crash.download */ "Télécharger le rapport de plantage",
  /* crash.copy */ "Copier le diagnostic",
  /* crash.dismiss */ "Supprimer le rapport",
  /* crash.copied */ "Diagnostic copié — collez-le dans un rapport de bogue",
  /* crash.copy_fail */ "Échec de la copie — ouvrez /coredump et /diag manuellement",
  /* crash.ask_dump */ "Le supprimer de l’appareil ? Le vidage mémoire sera également supprimé — téléchargez-le d’abord pour un rapport de bogue.",
  /* crash.ask */ "Supprimer ce rapport de l’appareil ?",
  /* crash.ask_yes */ "Supprimer",
  /* crash.ask_no */ "Conserver",
  /* crash.deleted */ "Rapport de plantage supprimé",
  /* crash.delete_fail */ "L’appareil n’a pas pu le supprimer — le rapport est toujours présent",
  /* bug.row */ "Signaler un bogue",
  /* bug.title */ "Signaler un bogue",
  /* bug.intro */ "Décrivez brièvement le problème. L’appareil ajoutera son état, ses relevés et son journal après avoir supprimé les noms de réseau, les adresses et les noms de serveur.",
  /* bug.what */ "Ce qui se passe",
  /* bug.need_text */ "Décrivez d’abord ce qui se passe — une ou deux phrases suffisent.",
  /* bug.continue */ "Préparer le rapport",
  /* bug.step2_title */ "Vérifier le rapport",
  /* bug.step2 */ "Vérifiez le rapport ci-dessous. Le bouton le copie et ouvre le formulaire de ticket GitHub avec votre description déjà renseignée. Collez le rapport dans « Device report », répondez aux questions restantes et envoyez le ticket.",
  /* bug.collecting */ "Collecte des données de l’appareil…",
  /* bug.collect_fail */ "Impossible de lire l’appareil — le rapport ci-dessous indique les parties manquantes.",
  /* bug.copy */ "Copier et ouvrir GitHub",
  /* bug.download */ "Télécharger le .md",
  /* bug.md_hint */ "Si la copie échoue ou si vous préférez un fichier, téléchargez le même rapport au format .md. Faites glisser le fichier dans le champ « Device report » du formulaire au lieu de coller le texte.",
  /* bug.copied */ "Rapport copié — collez-le dans le champ « Device report »",
  /* bug.copy_fail */ "Échec de la copie — sélectionnez le texte ci-dessous et copiez-le manuellement",
  /* bug.redacted */ "Le nom de votre réseau, les adresses, le broker et les noms de serveur ont déjà été supprimés.",
  /* nav.settings */ "Paramètres",
  /* nav.back */ "Retour",
  /* nav.cards */ "Cartes du tableau de bord",
  /* nav.diagnosis */ "Diagnostic",
  /* nav.outdoor */ "Unité extérieure",
  /* nav.settings_alert */ (n) => `Paramètres — ${n} ${n === 1 ? "connexion indisponible" : "connexions indisponibles"}`,
  /* src.modbus_tag */ "modbus",
  /* src.agree */ "Les deux sources concordent",
  /* src.delta */ (d, u) => `Différence ${d}${u ? " " + u : ""}`,
  /* src.disagree */ "Les deux sources ne concordent pas sur cet état",
  /* conn.homehub */ "HomeHub",
  /* group.Modbus */ "Modbus",
  /* conn.title */ "Connexions",
  /* conn.offline */ "Hors ligne",
  /* conn.disabled */ "Désactivé",
  /* conn.connecting */ "Connexion…",
  /* conn.connected */ "Connecté",
  /* conn.resolving */ "Résolution…",
  /* conn.eth_no_cable */ "Aucun câble",
  /* conn.eth_no_lease */ "Câble connecté, aucune adresse",
  /* conn.eth_fd */ "duplex intégral",
  /* conn.enabled */ "Activé",
  /* conn.enabled_noping */ "Activé, l’hôte ne répond pas au ping",
  /* conn.synced */ "Synchronisé",
  /* conn.syncing */ "Synchronisation…",
  /* conn.error */ (e) => "Erreur : " + e,
  /* conn.connected_to */ (s) => "Connecté à " + s,
  /* conn.aria */ (label, state) => `${label} : ${state}. Touchez pour modifier.`,
  /* modbus.err.mdns_not_found */ "Aucun HomeHub trouvé via mDNS.",
  /* modbus.err.no_address */ "Aucune adresse HomeHub n’est configurée.",
  /* modbus.err.resolve_failed */ "L’adresse du HomeHub n’a pas pu être résolue.",
  /* modbus.err.connect_timeout */ "Délai de connexion dépassé — le HomeHub est injoignable.",
  /* modbus.err.connection_refused */ "HomeHub joignable, mais le port Modbus TCP est fermé.",
  /* modbus.err.network_unreachable */ "Aucune route réseau vers le HomeHub.",
  /* modbus.err.host_unreachable */ "Le HomeHub est injoignable sur le réseau.",
  /* modbus.err.connect_failed */ "La connexion au HomeHub a échoué.",
  /* modbus.err.request_failed */ (r) => `Impossible de créer la requête Modbus${r ? ` pour le registre ${r}` : ""}.`,
  /* modbus.err.send_timeout */ (r) => `Délai d’envoi de la requête Modbus dépassé${r ? ` au registre ${r}` : ""}.`,
  /* modbus.err.send_failed */ (r) => `La requête Modbus n’a pas pu être envoyée${r ? ` au registre ${r}` : ""}.`,
  /* modbus.err.response_timeout */ (r) => `Délai de réponse du HomeHub dépassé${r ? ` au registre ${r}` : ""}.`,
  /* modbus.err.connection_closed */ (r) => `Le HomeHub a fermé la connexion${r ? ` au registre ${r}` : ""}.`,
  /* modbus.err.receive_failed */ (r) => `La réponse du HomeHub n’a pas pu être lue${r ? ` au registre ${r}` : ""}.`,
  /* modbus.err.invalid_response */ (r) => `Réponse Modbus non valide${r ? ` au registre ${r}` : ""}.`,
  /* modbus.err.internal_error */ "Le cycle d’interrogation Modbus a échoué en interne.",
  /* modbus.err.exception */ (r, n, why) => `HomeHub a rejeté le registre ${r || "?"} (exception ${n} : ${why}).`,
  /* modbus.exc.1 */ "fonction non autorisée",
  /* modbus.exc.2 */ "adresse de données non autorisée",
  /* modbus.exc.3 */ "valeur de données non autorisée",
  /* modbus.exc.4 */ "défaillance de l’appareil",
  /* modbus.exc.5 */ "requête acquittée",
  /* modbus.exc.6 */ "appareil occupé",
  /* modbus.exc.8 */ "erreur de parité mémoire",
  /* modbus.exc.10 */ "chemin de passerelle indisponible",
  /* modbus.exc.11 */ "la cible n’a pas répondu",
  /* modbus.exc.unknown */ "raison inconnue",
  /* card.model */ "Modèle",
  /* card.hplink */ "Liaison pompe à chaleur",
  /* card.online */ "En ligne",
  /* card.uptime */ "Durée de fonctionnement",
  /* card.freeheap */ "Mémoire libre",
  /* card.maxalloc */ "Plus grand bloc libre",
  /* card.offline */ "Hors ligne",
  /* card.protocol */ "Protocole",
  /* card.rxpin */ "Broche RX",
  /* card.txpin */ "Broche TX",
  /* card.capacity */ "Capacité",
  /* card.hplink_help */ "Indique si l’ESP32 reçoit actuellement des réponses valides de la pompe à chaleur via X10A.",
  /* card.protocol_help */ "X10A-I et X10A-S sont les deux formats de trame d’interface de service pris en charge. Le micrologiciel détecte le format à partir de réponses valides.",
  /* card.rxpin_help */ "GPIO sur lequel l’ESP32 reçoit les données X10A de la pompe à chaleur. Lorsque la liaison est hors ligne, le sélecteur lance une nouvelle tentative de détection automatique avec la paire choisie.",
  /* card.txpin_help */ "GPIO sur lequel l’ESP32 envoie les requêtes X10A à la pompe à chaleur. RX et TX doivent être différents et correspondre au câblage physique.",
  /* card.capacity_iu */ "Capacité (unité intérieure)",
  /* card.candidates */ "Modèles possibles",
  /* card.oueeprom */ "ID de l’unité extérieure",
  /* card.checkup */ "Diagnostic de l’installation · 24 h",
  /* service.title */ "Frigorigène (chauff.)",
  /* service.state.waiting */ "EN ATTENTE",
  /* service.state.observing */ "ENREGISTRE",
  /* service.state.limited */ "PARTIEL",
  /* service.state.interrupted */ "EN PAUSE",
  /* service.reason.unsupported_profile */ "Ce modèle ne fournit pas toutes les mesures nécessaires.",
  /* service.reason.compressor_not_running */ "Le compresseur ne fonctionne pas.",
  /* service.reason.unsupported_or_unknown_mode */ "Chauffage normal des locaux non confirmé.",
  /* service.reason.dhw_path */ "La pompe à chaleur chauffe l’eau chaude sanitaire.",
  /* service.reason.defrost */ "L’unité extérieure est en dégivrage.",
  /* service.reason.unit_fault */ "La pompe à chaleur signale un défaut ou un avertissement.",
  /* service.reason.special_controller_phase */ "Une courte phase de démarrage ou de régulation spéciale est active.",
  /* service.reason.missing_fresh_signal */ "Au moins une mesure actuelle nécessaire manque.",
  /* service.reason.poll_gap */ "La connexion X10A a été interrompue ou volontairement mise en pause.",
  /* service.window */ (d, n) => `${d} · ${n} ${n === 1 ? "mesure" : "mesures"}`,
  /* service.help.observing */ "Enregistrement de ce cycle de chauffage.",
  /* service.help.limited */ "Enregistrement actif ; contexte manquant indiqué ci-dessus.",
  /* service.help.interrupted */ "Redémarre au prochain cycle de chauffage admissible.",
  /* service.common */ "Un cycle de chauffage, séparé des vérifications de 24 h. Aucun diagnostic de charge de fluide ou de plage normale. Vanne : commande, pas position mesurée.",
  /* check.fault */ "Défaut de l’unité",
  /* check.dhw_loss */ "Refroidissement ECS",
  /* check.cycling */ "Démarrages compresseur",
  /* check.defrost */ "Dégivrages",
  /* check.pressure */ "Pression d’eau",
  /* check.flow */ "Débit min.",
  /* check.flow.lowest */ "Débit le plus bas en chauffage",
  /* check.flow.runup */ "Les mesures sont prises en compte après au moins dix minutes de chauffage des pièces sans interruption.",
  /* check.flow.assessment */ "La notice d’installation indique le débit minimal pour chaque modèle et mode de fonctionnement. Un débit trop faible peut déclencher l’erreur 7H.",
  /* check.flow.explain */ "Le débit indique combien de litres d’eau traversent la pompe à chaleur chaque minute.",
  /* check.flow.pump */ "Commande de la pompe",
  /* check.flow.live */ "Maintenant",
  /* check.flow.show */ "Afficher un minimum sur le graphique",
  /* check.flow.readout */ (value) => `Dans cet intervalle, au moins une mesure a donné ${value}. Le chauffage des pièces fonctionnait déjà depuis au moins dix minutes.`,
  /* check.flow.locations_missing */ "L’heure des anciennes mesures à cette valeur n’a pas été enregistrée.",
  /* check.flow.x10a_only */ "Le minimum en chauffage est calculé à partir des mesures X10A.",
  /* check.flow.waiting */ "En attente d’une période de chauffage qui remplit les conditions de mesure.",
  /* check.heater */ "Résistances",
  /* check.retries */ "Compteurs de protection",
  /* check.status.ok */ "OK",
  /* check.status.info */ "NOTE",
  /* check.status.warn */ "ALERTE",
  /* check.status.collecting */ "EN COURS",
  /* check.status.observation */ "MESURE",
  /* check.status.experimental */ "À L’ESSAI",
  /* check.status.unavailable */ "N/D",
  /* check.status.no_window */ "AUCUNE FENÊTRE",
  /* check.dhw.maximum */ "Plus forte baisse horaire à la sonde du ballon",
  /* check.dhw.hour_unit */ "°C par heure",
  /* check.dhw.timeline */ "Historique sur 24 h",
  /* check.dhw.context_title */ "Cause indéterminée",
  /* check.dhw.context_hour */ "Heure de mesure avec ce taux",
  /* check.dhw.context_missing */ "L’heure et les circonstances de cette mesure ne sont pas disponibles.",
  /* check.dhw.context_pump */ "La pompe à eau interne de la pompe à chaleur a fonctionné au cours de cette heure.",
  /* check.dhw.context_draw */ "La baisse rapide peut correspondre à un puisage d’eau chaude ou à un refroidissement rapide.",
  /* check.dhw.context_quiet */ "Aucun fonctionnement de la pompe ni baisse évoquant un puisage n’a été détecté. Un puisage d’eau chaude reste possible.",
  /* check.dhw.context_selected */ "La cause de cette baisse reste indéterminée.",
  /* check.dhw.hint */ "Une heure sans indice de pompe ou de puisage enregistré a atteint le seuil indicatif du projet.",
  /* check.dhw.before_snapshot */ (d) => `${d} avant l’instantané`,
  /* check.dhw.marker_yes */ "enregistré",
  /* check.dhw.marker_no */ "non enregistré",
  /* check.dhw.pump */ "Pompe interne",
  /* check.dhw.draw */ "Chute évoquant un puisage",
  /* check.dhw.previous */ "Fenêtre terminée précédente",
  /* check.dhw.next */ "Fenêtre terminée suivante",
  /* check.dhw.timeline_unavailable */ "Fenêtres horodatées indisponibles. Aucun historique n’est déduit des totaux.",
  /* check.dhw.timeline_empty */ "Aucune fenêtre horodatée terminée disponible dans cette vue sur 24 h.",
  /* check.dhw.chart_title */ "Refroidissement par fenêtre terminée",
  /* check.dhw.timed_scope */ (n) => `Heures mesurées dans le graphique : ${n} (dernières 24 h). Le maximum et les décomptes peuvent aussi provenir de données horaires sauvegardées, pas seulement des fenêtres tracées.`,
  /* check.dhw.blank */ "Zones hachurées : aucune fenêtre horodatée terminée disponible, pas un refroidissement nul. Les marques indiquent une présence, pas une durée.",
  /* check.dhw.snapshot */ "Instantané",
  /* check.dhw.stale */ "Les mesures actuelles du refroidissement du ballon ECS manquent ou sont périmées ; les fenêtres terminées restent des observations historiques.",
  /* check.dhw.limit */ "R5T mesure un point du ballon stratifié, pas son énergie. Les indices de pompe et de puisage ne prouvent ni la cause ni une consommation d’eau.",
  /* check.dhw.basis */ "Détail des données",
  /* check.dhw.energy */ "Exemple de calcul · pas d’énergie mesurée",
  /* check.detail.dhw_energy */ (a, b, c, d) => `Exemple sur une heure : 200 l d’eau refroidis uniformément à ${a} K/h → ${b} kWh de chaleur ; recharge de ${c}–${d} kWh électriques à COP supposé 2,5–3 (chaleur ÷ électricité). Pas d’énergie mesurée.`,
  /* check.detail.dhw_context */ (a, b, c) => `Fenêtres : pompe interne ${a} ; chute évoquant un puisage ${b} ; sans indice ≥0,8 K/h ${c}. Recoupement possible.`,
  /* check.detail.value_label */ "Valeur :",
  /* check.detail.assessment_label */ "Évaluation :",
  /* check.detail.ok */ "Cette règle n’a pas été déclenchée dans les données lisibles.",
  /* check.detail.info */ "Indice observé ; sa limite figure ci-dessous.",
  /* check.detail.warn */ "Erreur de l’unité ou pression basse prolongée observée.",
  /* check.detail.fault.error */ "L’unité signale actuellement une erreur. Le code exact figure sur la carte « Fonctionnement ».",
  /* check.detail.fault.warning */ "L’unité signale actuellement un avertissement ou une mise en garde, et non une erreur. Le code exact figure sur la carte « Fonctionnement ».",
  /* check.detail.fault.past */ "Aucun message actif ; un message a été enregistré. Sa disparition ne prouve ni sa cause ni sa résolution.",
  /* check.detail.fault.past_unknown */ "Un message a été enregistré ; l’état actuel du défaut est illisible.",
  /* check.detail.collecting */ (a, b) => `Signaux lisibles : ${a} sur ${b} requis.`,
  /* check.detail.outdoor_defrost */ " Les valeurs extérieures X10A ne comprennent que des mesures récentes lorsque les états du dégivrage et du compresseur étaient tous deux lisibles et que le compresseur fonctionnait. Elles fournissent du contexte et ne modifient ni le seuil de dégivrage ni le verdict.",
  /* check.detail.dhw_candidate */ (a, b, c, d) => `Fenêtres horaires admises : ${a} ; candidate actuelle : ${c} sur ${d}.`,
  /* check.detail.dhw_settling */ (a, b, c) => `Fenêtres horaires admises : ${a} ; charge ou résistance du ballon détectée. Stabilisation restante : ${c}.`,
  /* check.detail.dhw_waiting */ (a, b) => `Fenêtres horaires admises : ${a} ; attente de la prochaine heure admissible.`,
  /* check.detail.dhw_aborted */ (n, reasons, best) => ` ${n} ${n === 1 ? "fenêtre candidate rejetée" : "fenêtres candidates rejetées"} (${reasons}) ; la plus longue a atteint ${best} sur 60 min.`,
  /* check.detail.dhw_blocked */ (a, b, c) => "Aucune heure complète en 24 h." + (a > 0 ? ` Fenêtres écartées : ${a} (${b}) ; la plus longue ${c}.` : ""),
  /* check.detail.dhw_blocked_link */ (a, b) => `Aucune fenêtre horaire admissible en 24 h : Fenêtres interrompues : ${a}, après une longue absence des mesures nécessaires ; plus longue ${b} sur 60 min. Réponses manquantes ou pauses de lecture peuvent créer la lacune. Aucun constat sur le ballon.`,
  /* check.detail.dhw_reason.charge */ "charge du ballon",
  /* check.detail.dhw_reason.pump */ "pompe interne",
  /* check.detail.dhw_reason.draw */ "baisse semblable à un puisage",
  /* check.detail.dhw_reason.reading */ "R5T non confirmé",
  /* check.detail.dhw_reason.blind */ "relevés manquants : X10A sans réponse ou interrogation en pause",
  /* check.detail.collecting_unknown */ "Pas d’évaluation actuelle.",
  /* check.detail.observation */ "Observation seule ; aucune limite universelle OK/ALERTE.",
  /* check.detail.experimental */ "Compteurs expérimentaux ; stabilité n’exclut pas une limitation.",
  /* check.detail.unavailable */ "Aucun signal évaluable dans ce profil.",
  /* check.starts */ (n) => `${n} ${n === 1 ? "démarrage" : "démarrages"}`,
  /* check.cycles */ (n) => `${n} ${n === 1 ? "cycle" : "cycles"}`,
  /* check.paired_cycles */ (n) => `${n} ${n === 1 ? "apparié" : "appariés"}`,
  /* check.cycling.runs */ (n) => `${n} ${n === 1 ? "cycle" : "cycles"}`,
  /* check.cycling.mean */ (d) => `Moy. ${d}`,
  /* check.cycling.completed */ "Cycles terminés",
  /* check.cycling.unclear */ "Usage incertain",
  /* check.cycling.unclear_hint */ "Un cycle peut changer de mode ou n’avoir été observé qu’en partie.",
  /* check.cycling.short */ "Les cycles de chauffage sont courts en moyenne.",
  /* check.cycling.normal */ "Les cycles de chauffage durent assez longtemps en moyenne.",
  /* check.cycling.few */ "Trop peu de cycles de chauffage pour l’instant.",
  /* check.cycling.waiting */ "Données encore insuffisantes.",
  /* check.cycling.class_unavailable */ "Cette installation fournit trop peu d’informations sur les cycles de chauffage.",
  /* check.cycling.unavailable */ "Aucune donnée du compresseur.",
  /* check.cycling.stale */ "Des mesures manquent actuellement.",
  /* check.cycling.history_empty */ "Pas encore d’historique.",
  /* check.cycling.timed_starts */ (s) => `${s} avec heure enregistrée`,
  /* check.cycling.run_start */ "Démarrage",
  /* check.cycling.run_stop */ "Arrêt",
  /* check.cycling.run_duration */ "Durée",
  /* check.cycling.run_ongoing */ "En cours",
  /* check.cycling.run_stop_unknown */ "Arrêt inconnu",
  /* check.cycling.no_timed_runs */ "Aucune heure de démarrage relevée sur cette période.",
  /* check.cycling.run_details_unavailable */ "Les horaires des cycles individuels sont indisponibles pour cette heure.",
  /* check.cycling.saved_starts */ (s) => `Sur ce total, ${s} proviennent des relevés horaires d’avant le redémarrage.`,
  /* check.cycling.short_runs */ (n) => `${n} < 5 min`,
  /* check.cycling.col_stop */ "Raison de l’arrêt",
  /* check.cycling.stop_low_flow */ "Départ au-dessus de la consigne · faible débit",
  /* check.cycling.stop_low_rps */ "Départ au-dessus de la consigne · bas régime",
  /* check.cycling.stop_req_off */ "Fin de demande compresseur",
  /* check.cycling.stop_tgt_drop */ "Consigne abaissée",
  /* check.cycling.stop_defrost */ "Pause pour dégivrage",
  /* check.cycling.stop_defrost_done */ "Dégivrage terminé",
  /* check.cycling.stop_dhw */ "Passage en ECS",
  /* check.cycling.stop_normal_dhw */ "Cycle ECS terminé",
  /* check.cycling.stop_normal */ "Arrêt normal",
  /* check.cycling.out_cond */ (v) => ` (${v} ext.)`,
  /* check.cycling.find_low_flow */ (minFlow, typ) => `Cycles courts, faible débit : sur consigne en min (${minFlow}${typ}).`,
  /* check.cycling.find_low_rps */ (flow, cond) => `Cycles courts, bas régime${cond} : sur consigne tôt (${flow}).`,
  /* check.cycling.find_control */ "Arrêt sur contrôle : demande off ou consigne baissée.",
  /* check.cycling.find_defrost_dhw */ (cond) => `Dégivrage & ECS${cond} : pause pour dégivrage et ECS.`,
  /* check.cycling.find_defrost */ (cond) => `Dégivrage${cond} : pause pour dégivrer.`,
  /* check.cycling.find_dhw */ "ECS : pause pour ECS.",
  /* check.cycling.find_steady */ (flow) => flow ? `Chauffage stable : min. ${flow}.` : "Chauffage stable.",
  /* check.cycling.pause_tag */ (d) => ` après ${d} de pause`,
  /* check.cycling.cond_tag */ (lwt, tgt) => tgt ? `départ ${lwt}, consigne ${tgt}` : `départ ${lwt}`,
  /* check.cycling.from_tag */ (prev) => ` de ${prev}`,
  /* check.cycling.rwt_tag */ (rwt) => `retour ${rwt}`,
  /* check.cycling.typ_tag */ (typ) => `, habituel ${typ}`,
  /* check.cycling.s_cool */ (at, pause, lwt, tgt) => `Début ${at}${pause} : départ ${lwt}, consigne ${tgt}, demande active.`,
  /* check.cycling.s_req */ (at, pause, cond) => `Début ${at}${pause} : demande active${cond}.`,
  /* check.cycling.s_tgt */ (at, pause, prev, tgt, cond) => `Début ${at}${pause} : consigne relevée${prev} à ${tgt}${cond}.`,
  /* check.cycling.s_defrost_after */ (at, pause, cond) => `Reprise ${at}${pause}, fin de dégivrage${cond}.`,
  /* check.cycling.s_dhw_after */ (at, pause, cond) => `Reprise ${at}${pause}, fin d’ECS${cond}.`,
  /* check.cycling.s_defrost */ (at, pause) => `Début ${at}${pause} pour dégivrage.`,
  /* check.cycling.s_dhw */ (at, pause, cond) => `Début ${at}${pause} pour ECS${cond}.`,
  /* check.cycling.s_gen */ (at, pause, cond) => `Début ${at}${pause}${cond}.`,
  /* check.cycling.e_low_flow */ (to, lwt, tgt, rwt, flow, typ) => `Arrêt ${to} : départ ${lwt} au-dessus de ${tgt}${rwt} à ${flow}${typ}.`,
  /* check.cycling.e_low_rps */ (to, lwt, tgt, rwt, flow, rps) => `Arrêt ${to} : départ ${lwt} au-dessus de ${tgt}${rwt} à ${flow} et ${rps}.`,
  /* check.cycling.e_req */ (to, vals) => `Arrêt ${to} : demande coupée${vals}.`,
  /* check.cycling.e_tgt */ (to, prev, tgt, vals) => `Arrêt ${to} : consigne abaissée${prev} à ${tgt}${vals}.`,
  /* check.cycling.e_defrost_run */ (to, vals) => `Fin de dégivrage ${to}${vals}.`,
  /* check.cycling.e_defrost_pause */ (to, vals) => `Arrêt ${to} pour dégivrage${vals}.`,
  /* check.cycling.e_dhw */ (to, vals) => `Arrêt ${to} : passage en ECS${vals}.`,
  /* check.cycling.e_norm */ (to, vals) => `Fin ${to}${vals}.`,
  /* check.cycling.e_ongoing */ "Actif au dernier relevé.",
  /* check.cycling.cause_unavailable */ "Sans détails",
  /* check.cycling.cause_older_unavailable */ "Aucun détail enregistré sur le démarrage ou l’arrêt n’est disponible pour ces anciens cycles.",
  /* check.outdoor_one */ (source, mean) => `${source} ${mean} °C`,
  /* check.outdoor_range */ (source, min, mean) => `${source} min. ${min} °C · moyenne ${mean} °C`,
  /* check.min */ (m) => `${m} min`,
  /* check.tank_runtime */ (d) => `ballon ${d}`,
  /* check.buh_runtime */ (d) => `appoint ${d}`,
  /* check.buh_short */ "App.",
  /* check.tank_short */ "Ballon",
  /* check.hour.latest */ "Dernier intervalle",
  /* check.hour.earlier */ (h) => `${h} h plus tôt`,
  /* check.hour.other */ "Autre / inconnu",
  /* check.hour.gap */ "Lacune de mesure",
  /* check.hour.coverage */ (observed, possible) => possible ? `${observed} sur ${possible} observés` : `${observed} observés · temps écoulé inconnu`,
  /* check.hour.ending */ (time) => `Fin de l’intervalle ${time}`,
  /* check.hour.saved */ (time) => `Heure enregistrée ${time}`,
  /* check.loss_windows */ (n) => `${n} ${n === 1 ? "fenêtre" : "fenêtres"}`,
  /* check.fault_err */ "Défaut actif",
  /* check.fault_warn */ "Avertissement actif",
  /* check.fault_past */ "Actif auparavant",
  /* check.fault_none */ "Aucun actif",
  /* check.fault_unknown */ "Inconnu",
  /* check.fault_past_unknown */ "Passé · inconnu",
  /* check.fault_since_short */ (d) => `depuis ${d}`,
  /* check.fault_ago_short */ (d) => `il y a ${d}`,
  /* check.fault_hero_ok */ (d) => `Aucun défaut ni avertissement signalé sur ${d} d'observation en 24 h.`,
  /* check.fault_latched_only */ "Indicateur de défaut mémorisé signalé par la pompe à chaleur ; aucun épisode horodaté ne figure dans les 24 h enregistrées.",
  /* check.fault_unit_outdoor */ "Unité extérieure",
  /* check.fault_unit_indoor */ "Unité intérieure",
  /* check.fault_unit_both */ "Extérieure + intérieure",
  /* check.fault_secondary */ (s) => `Également actif : ${s}`,
  /* check.fault_stop_ongoing */ "actif",
  /* check.fault_stop_unknown */ "incertain",
  /* check.fault_col_code */ "Code",
  /* check.fault_col_meaning */ "Signification",
  /* check.fault_ok_label */ "Sans défaut",
  /* check.fault_gap_label */ "Non mesuré",
  /* check.fault_severity_caution */ "Prudence",
  /* check.retry_seen */ "Hausse",
  /* check.retry_none */ "Aucune hausse",
  /* service.metric.comp */ "Compresseur",
  /* service.metric.disch */ "Température de refoulement",
  /* service.metric.eev */ "Commande de vanne de détente",
  /* service.metric.hp */ "Haute pression",
  /* service.metric.lp */ "Basse pression",
  /* check.hydronic.agree_labels */ "Pompe seule R1T−R4T|Pompe seule R2T−R1T|État de concordance|Limites de concordance",
  /* check.hydronic.agree_reasons */ "Débit sous 5,0 l/min|Compresseur en marche|Appoint actif ou ambigu|Vanne 3 voies changée|Températures non stationnaires",
  /* check.hydronic.agree_limits */ "R2T indisponible|Voie ECS incluse",
  /* check.hydronic.agree_meta */ "fenêtres|mesures|Concordance passive uniquement ; pas d'étalonnage ; chaleur externe non exclue.",
  /* service.metric.range */ (a, b, c, d) => `min. ${a} · moyenne ${b} · max. ${c} ${d}`,
  /* service.metric.samples */ n => `${n} ${n === 1 ? "mesure retenue" : "mesures retenues"}`,
  /* service.metric.input_none */ "Aucune entrée sélectionnée",
  /* service.metric.meta_limit */ "Les nombres sont des mesures retenues, pas une couverture temporelle. Une entrée sélectionnée ne prouve pas une mesure actuelle.",
  /* service.limit.special_phases_unavailable */ "Phases du régulateur",
  /* service.limit.temperature_context_incomplete */ "Contexte de température",
  /* service.limit.pressure_sides_incomplete */ "Côté(s) de pression",
  /* service.limit.outdoor_context_incomplete */ "Contexte extérieur",
  /* service.row.limits */ "Contexte manquant :",
  /* check.loss_max */ (a) => `maximum ${a} K/h`,
  /* check.loss_high */ (a, b) => `${a}/${b} fenêtres : seuil atteint`,
  /* check.detail.period_label */ "Période des données :",
  /* check.detail.period */ (a) => `${a}, au plus 24 h ; lacunes possibles`,
  /* check.detail.age_label */ "Âge de la dernière mesure :",
  /* check.detail.horizon_wait */ (a) => `La fenêtre complète de 24 heures manque encore : ${a} restantes.`,
  /* check.detail.fault.ok */ "Aucun message actuel ou mémorisé dans les signaux de défaut lisibles.",
  /* check.detail.defrost.info */ "≥3 dégivrages associés dépassent 15 % du temps lisible du compresseur : indice du projet.",
  /* check.detail.defrost.ok */ "Aucun indice de part ; météo et lacunes non évaluées.",
  /* check.defrost.last_start */ (date, route, outdoor) => `Dernier début de dégivrage observé · ${date} · Circuit ${route} · Air extérieur ${outdoor}`,
  /* check.defrost.route_space */ "Chauffage",
  /* check.defrost.route_dhw */ "Ballon d’eau chaude",
  /* check.detail.pressure.info */ "Basse",
  /* check.detail.pressure.warn */ "Critique",
  /* check.detail.pressure.ok */ "Normale",
  /* check.detail.defrost_events_insufficient */ "Moins de trois dégivrages associés ; aucun verdict de part.",
  /* check.detail.source_stale */ "Pas de mesure X10A récente ; état actuel inconnu. Historique conservé.",
  /* check.detail.no_paired_runtime */ "Pas de durée lisible associée ; nombre seulement.",
  /* check.detail.current_label */ "≤1,0 bar basse",
  /* check.detail.minimum_time_label */ "≤0,5 bar critique",
  /* check.detail.coverage_missing */ (a) => `Temps lisible manquant : ${a} s.`,
  /* check.detail.channel_coverage */ (a, b) => `${a} : couverture ${b}`,
  /* check.summary.warnings */ (n) => `${n} ${n === 1 ? "avertissement" : "avertissements"}`,
  /* check.summary.notes */ (n) => `${n} ${n === 1 ? "note" : "notes"}`,
  /* check.summary.ok */ "Aucun indice dans les données évaluées",
  /* check.summary.collecting */ "Collecte de données",
  /* check.summary.observations */ "Observations",
  /* values.waiting */ "En attente de la première interrogation…",
  /* values.sg_x10a_mode */ "Mode Smart Grid (contacts X10A)",
  /* group.Operation */ "Fonctionnement",
  /* group.Domestic hot water */ "Eau chaude sanitaire",
  /* group.Water circuit */ "Circuit d’eau",
  /* group.Refrigerant / outdoor */ "Réfrigérant / extérieur",
  /* group.Electrical */ "Électricité",
  /* group.Device */ "Appareil",
  /* group.Other values */ "Autres valeurs",
  /* group.Protection */ "Protection",
  /* protect.limiting */ "limitation en cours",
  /* group.Values */ "Valeurs",
  /* state.on */ "MARCHE",
  /* state.off */ "ARRÊT",
  /* enum.auto */ "Auto",
  /* enum.heating */ "Chauffage",
  /* enum.cooling */ "Rafraîchissement",
  /* enum.no_error */ "Aucune erreur",
  /* enum.fault */ "Défaut",
  /* enum.warning */ "Avertissement",
  /* enum.space_heating */ "Chauffage des locaux",
  /* enum.dhw */ "ECS",
  /* enum.free_running */ "Fonctionnement libre",
  /* enum.forced_off */ "Arrêt forcé",
  /* enum.recommended_on */ "Marche recommandée",
  /* enum.forced_on */ "Marche forcée",
  /* enum.space_cooling */ "Refroidissement des locaux",
  /* enum.none */ "Aucun",
  /* enum.reduced */ "Réduit",
  /* enum.automatic */ "Automatique",
  /* enum.manual */ "Manuel",
  /* enum.actuator */ "Actionneur",
  /* enum.tank_heat_up */ "Chauffage du ballon",
  /* a4.quiet_selection */ "Sélection du mode silencieux",
  /* a4.heating_offset */ "Décalage du chauffage selon la température extérieure, zone principale",
  /* a4.imposed_power_limit */ "Limite de puissance imposée",
  /* a4.pre_phe_outdoor */ "Température de l’eau avant l’échangeur à plaques extérieur",
  /* a4.main_target */ "Consigne de chauffage/rafraîchissement, zone principale",
  /* a4.quiet_help */ "Sélectionne Arrêt, Automatique ou Manuel pour le fonctionnement silencieux. Cela n’indique pas si le mode silencieux est actuellement actif ; le niveau ou la programmation sélectionnés peuvent toujours prévoir Arrêt.",
  /* a4.current_help */ "Indique Aucun, Chauffage ou Rafraîchissement pour la climatisation des locaux. À lire avec l’indicateur de fonctionnement normal ; cela ne prouve pas que le compresseur fonctionne.",
  /* a4.limit_help */ "La limite de puissance électrique imposée, pas la consommation mesurée. Le fonctionnement de protection peut dépasser ce réglage.",
  /* a4.demand_help */ "Indique Fonctionnement libre, Arrêt forcé, Marche forcée, Marche recommandée ou Réduit comme réponse à la demande énergétique. Ces codes numériques diffèrent de la sélection Smart Grid configurée.",
  /* a4.operation_help */ "Indique Arrêt, Chauffage du ballon, Chauffage des locaux, Rafraîchissement des locaux ou Fonctionnement de l’actionneur. Il s’agit d’un état signalé, pas d’une preuve de transfert thermique utile.",
  /* a4.heating_offset_help */ "Décale la courbe de chauffe selon la météo de la zone principale, en kelvins. Ce décalage n’est ni une température mesurée ni la consigne complète de température de l’eau.",
  /* a4.pre_phe_outdoor_help */ "Température de l’eau avant l’échangeur à plaques extérieur. Ce capteur mesure le côté eau, pas la température de l’air extérieur ni du réfrigérant.",
  /* a4.flow_help */ "La conversion du débit Altherma 4 n'est pas vérifiée. La valeur en L/min utilise la conversion existante ; comparez-la à la mesure de l'unité avant d'évaluer les performances.",
  /* a4.pump_help */ "Le guide Altherma 4 nomme la vitesse de pompe mais indique L/min. L'unité % affichée est une hypothèse non vérifiée ; comparez avec la mesure de l'unité.",
  /* a4.pressure_help */ "La conversion de pression Altherma 4 n'est pas vérifiée. La valeur en bar utilise la conversion existante ; comparez-la à la mesure de l'unité avant d'évaluer la pression.",
  /* a4.demand_response */ "Mode de réponse à la demande",
  /* a4.unit_operation */ "État de fonctionnement de l’unité",
  /* a4.cooling_offset */ "Correction froid selon la température extérieure, zone principale",
  /* a4.add_target */ "Cible chauffage/froid, zone additionnelle",
  /* a4.abnormality_counter */ "Compteur d’anomalies utilisateur",
  /* a4.cooling_offset_help */ "Déplace en kelvin la courbe de refroidissement climatique de la zone principale. C’est un décalage, pas une température mesurée ni la consigne complète de départ.",
  /* a4.abnormality_help */ "Compteur cumulé d’anomalies signalées côté utilisateur par l’unité. Une valeur constante non nulle reflète des événements passés, pas un défaut actif ; vérifier Anomalie de l’unité et son code défaut.",
  /* enum.unknown */ (n) => `Inconnu (${n})`,
  /* chip.space_on */ "Locaux actifs",
  /* chip.space_off */ "Locaux arrêtés",
  /* chip.quiet */ "Silencieux",
  /* schem.sg_boost */ "RENFORT",
  /* sg.mode0 */ "Fonctionnement libre",
  /* sg.mode1 */ "Arrêt forcé",
  /* sg.mode2 */ "Marche recommandée",
  /* sg.mode3 */ "Marche forcée",
  /* schem.to_dhw */ "3WV → ECS",
  /* schem.to_space */ "3WV → locaux",
  /* normal.label */ "Normal :",
  /* meaning.label */ "Comment l’interpréter :",
  /* hist.title */ "Dernières 24 heures",
  /* hist.recorded */ (h) => `Enregistré · ${h} h`,
  /* hist.now */ "maintenant",
  /* hist.ago */ (h) => `il y a ${h} h`,
  /* hist.retained */ "Dernière mesure reçue",
  /* hist.before_retained */ (h) => `${h} h avant la dernière mesure reçue`,
  /* hist.loading */ "Chargement de la tendance…",
  /* hist.none */ "Aucun relevé enregistré pour le moment.",
  /* hist.err */ "Tendance indisponible.",
  /* hist.gaps */ (n) => `${n} ${n === 1 ? "lacune" : "lacunes"} — non mesuré`,
  /* hist.nm */ "non mesuré",
  /* hist.rel */ (h) => `il y a ${h} h`,
  /* hist.held */ "unité extérieure au repos",
  /* hist.heldnote */ (h) => `${h} h au repos — non mesuré`,
  /* hist.aria */ (l) => `${l} — tendance sur 24 heures. Les touches fléchées lisent les échantillons individuels.`,
  /* hist.aria_pinned */ (l, r) => `${l} — tendance sur 24 heures. Relevé épinglé : ${r}. Touchez-le de nouveau pour l’effacer.`,
  /* hist.pin_hint */ "toucher pour épingler",
  /* hist.duration_min */ (m) => `${m} min`,
  /* hist.duration_h */ (h) => `${h} h`,
  /* hist.duration_hm */ (h, m) => `${h} h ${m} min`,
  /* hist.duration_sec */ (s) => `${s} s`,
  /* hist.state_phase_run */ (state, when, d) => `${state}\n${when} · env. ${d}`,
  /* hist.state_active */ "Actif",
  /* hist.state_off */ "Arrêté",
  /* val.since */ (d) => `depuis ${d}`,
  /* val.since_min */ (d) => `\u2265 ${d}`,
  /* val.since_gap */ (d) => `${d} non observé`,
  /* hist.modbus_plateau */ (when, d) => `registre inchangé ${when} · env. ${d} · ancienneté de la mesure inconnue`,
  /* hist.boost_total */ (d) => `Renfort · ${d}`,
  /* hist.boost_none */ "Aucun renfort pendant la période enregistrée.",
  /* hist.boost_ago_range */ (a, b) => `il y a ${a}–${b} h`,
  /* hist.boost_active */ "Renfort actif",
  /* hist.boost_inactive */ "Renfort arrêté",
  /* hist.boost_aria */ (l, d) => `${l} — chronologie de l’état Smart Grid avec les quatre modes. ${d}. Les touches fléchées lisent les échantillons individuels.`,
  /* hist.defrost_total */ (d) => `Dégivrage · ${d}`,
  /* hist.defrost_none */ "Aucun cycle de dégivrage observé pendant la période enregistrée.",
  /* hist.defrost_active */ "Dégivrage",
  /* hist.defrost_inactive */ "Pas de dégivrage",
  /* hist.defrost_aria */ (l, d) => `${l} — chronologie du dégivrage. ${d}. Les touches fléchées lisent les échantillons individuels.`,
  /* hist.quiet_total */ (d) => `Silencieux · ${d}`,
  /* hist.quiet_none */ "Aucun intervalle en mode silencieux observé pendant la période enregistrée.",
  /* hist.quiet_active */ "Silencieux actif",
  /* hist.quiet_inactive */ "Silencieux inactif",
  /* hist.quiet_aria */ (l, d) => `${l} — chronologie du mode silencieux. ${d}. Les touches fléchées lisent les échantillons individuels.`,
  /* hist.heater_total */ (d) => `Résistance · ${d}`,
  /* hist.heater_none */ "Aucune utilisation de la résistance du ballon observée pendant la période enregistrée.",
  /* hist.heater_active */ "Résistance active",
  /* hist.heater_inactive */ "Résistance inactive",
  /* hist.heater_aria */ (l, d) => `${l} — chronologie de la résistance du ballon. ${d}. Les touches fléchées lisent les échantillons individuels.`,
  /* hist.preheat_total */ (d) => `Préchauffage · ${d}`,
  /* hist.preheat_none */ "Aucun intervalle de préchauffage du ballon observé pendant la période enregistrée.",
  /* hist.preheat_active */ "Préchauffage actif",
  /* hist.preheat_inactive */ "Préchauffage inactif",
  /* hist.preheat_aria */ (l, d) => `${l} — chronologie X10A du préchauffage du ballon. ${d}. Les touches fléchées lisent les échantillons individuels.`,
  /* hist.disinfection_total */ (d) => `Désinfection · ${d}`,
  /* hist.disinfection_none */ "Aucune opération de désinfection observée pendant la période enregistrée.",
  /* hist.disinfection_active */ "Désinfection active",
  /* hist.disinfection_inactive */ "Désinfection inactive",
  /* hist.disinfection_aria */ (l, d) => `${l} — chronologie de la désinfection HomeHub. ${d}. Les touches fléchées lisent les échantillons individuels.`,
  /* hist.buh_total */ (d) => `Appoint · ${d}`,
  /* hist.buh_none */ "Aucune utilisation du chauffage d’appoint observée pendant la période enregistrée.",
  /* hist.buh_active */ "Appoint actif",
  /* hist.buh_inactive */ "Appoint inactif",
  /* hist.buh_step1 */ "Étage 1",
  /* hist.buh_step2 */ "Étage 2",
  /* hist.buh_aria */ (l, d) => `${l} — chronologie du chauffage d’appoint. ${d}. Les touches fléchées lisent les échantillons individuels.`,
  /* hist.valve_dhw_total */ (d) => `ECS · ${d}`,
  /* hist.valve_space_total */ (d) => `Locaux · ${d}`,
  /* hist.valve_none */ "Aucune position ECS pendant la période enregistrée.",
  /* hist.valve_dhw */ "ECS",
  /* hist.valve_space */ "Locaux",
  /* hist.valve_aria */ (l, d) => `${l} — chronologie de la vanne 3 voies. ${d}. Les touches fléchées lisent les échantillons individuels.`,
  /* hist.circ_total */ (d) => `Pompe · ${d}`,
  /* hist.circ_none */ "Aucun fonctionnement de la pompe observé pendant la période enregistrée.",
  /* hist.circ_on */ "En marche",
  /* hist.circ_off */ "Arrêtée",
  /* hist.circ_unavailable */ "Indisponible",
  /* hist.circ_gaps */ (n) => `${n} ${n === 1 ? "intervalle indisponible" : "intervalles indisponibles"}`,
  /* hist.circ_aria */ (l, d) => `${l} — chronologie de la pompe de circulation. ${d}. Les touches fléchées lisent les échantillons individuels.`,
  /* hist.valve2_on_total */ (d) => `2WV active · ${d}`,
  /* hist.valve2_off_total */ (d) => `2WV inactive · ${d}`,
  /* hist.valve2_on */ "2WV active",
  /* hist.valve2_off */ "2WV inactive",
  /* hist.valve2_none */ "Aucun état actif enregistré pour la sortie de la vanne 2 voies pendant la période sélectionnée.",
  /* hist.valve2_aria */ (l, d) => `${l} — chronologie de la sortie de la vanne 2 voies. ${d}. Les touches fléchées lisent les échantillons individuels.`,
  /* hist.flow_switch_total */ (d) => `Fluxostat actif · ${d}`,
  /* hist.flow_switch_on */ "Fluxostat actif",
  /* hist.flow_switch_off */ "Fluxostat inactif",
  /* hist.flow_switch_none */ "Aucun état actif enregistré pour ce signal X10A pendant la période sélectionnée.",
  /* hist.flow_switch_aria */ (l, d) => `${l} — chronologie du détecteur de débit d’eau. ${d}. Les touches fléchées lisent les échantillons individuels.`,
  /* hist.comp_total */ (d, n) => `Compresseur · ${d} · ${n} ${n === 1 ? "phase" : "phases"}`,
  /* hist.comp_none */ "Aucun fonctionnement du compresseur observé sur la période enregistrée.",
  /* hist.comp_active */ "Compresseur en marche",
  /* hist.comp_inactive */ "Compresseur arrêté",
  /* hist.comp_aria */ (l, d) => `${l} — chronologie du compresseur HomeHub. ${d}. Les touches fléchées lisent les échantillons individuels.`,
  /* hist.mb_defrost_total */ (d) => `Dégivrage / redémarrage · ${d}`,
  /* hist.mb_defrost_none */ "Aucune phase de dégivrage ou de redémarrage observée sur la période enregistrée.",
  /* hist.mb_defrost_active */ "Dégivrage / redémarrage",
  /* hist.mb_defrost_inactive */ "Normal / arrêt",
  /* hist.mb_defrost_aria */ (l, d) => `${l} — chronologie dégivrage/redémarrage HomeHub. ${d}. Les touches fléchées lisent les échantillons individuels.`,
  /* hist.pump_total */ (d) => `Circulateur · ${d}`,
  /* hist.pump_none */ "Aucun fonctionnement du circulateur observé sur la période enregistrée.",
  /* hist.pump_active */ "Circulateur en marche",
  /* hist.pump_inactive */ "Circulateur arrêté",
  /* hist.pump_aria */ (l, d) => `${l} — chronologie du circulateur HomeHub. ${d}. Les touches fléchées lisent les échantillons individuels.`,
  /* toast.saved */ "Enregistré",
  /* toast.no_changes */ "Aucune modification",
  /* toast.reboot */ "Redémarrage — reconnexion…",
  /* toast.rebooted */ "Redémarré — reconnectez-vous à l’appareil",
  /* board.draft_stale */ "Les réglages de la carte ont changé. Rouvrez l’éditeur avant d’enregistrer.",
  /* toast.busy_retry */ "Appareil occupé — réessayez dans un instant",
  /* toast.unreachable */ "Impossible de joindre l’appareil",
  /* toast.rejected */ "Rejeté",
  /* toast.applying */ "La dernière modification est toujours en cours d’application…",
  /* toast.check_wifi */ "Vérifiez les paramètres WiFi",
  /* toast.check_broker */ "Vérifiez l’adresse du broker",
  /* toast.check_syslog_port */ "Vérifiez le port Syslog",
  /* toast.verifying_mqtt */ "Vérification de la connexion MQTT…",
  /* toast.saving_syslog */ "Enregistrement des paramètres Syslog…",
  /* toast.saving_ntp */ "Enregistrement des paramètres NTP…",
  /* toast.trying_pins */ "Essai des broches…",
  /* toast.saving_board */ "Enregistrement du matériel de la carte…",
  /* ota.uptodate */ "à jour",
  /* ota.check_failed */ "échec de la vérification",
  /* ota.starting */ "démarrage…",
  /* ota.pct */ (p) => `${p}%`,
  /* ota.rebooting */ "redémarrage…",
  /* ota.failed */ "échec de la mise à jour",
  /* ota.timeout */ "délai dépassé",
  /* ota.cancelled */ "annulée",
  /* ota.busy */ "appareil occupé",
  /* ota.replaced */ "L’opération de mise à jour a changé — vérifiez à nouveau",
  /* ota.unreachable */ "appareil injoignable",
  /* ota.active_title */ "Mise à jour du micrologiciel",
  /* ota.active_sub */ (detail) => `Installation en cours · ${detail}`,
  /* ota.active_sub_cached */ (detail) => `Installation en cours · ${detail} · dernier état reçu`,
  /* ota.snapshot_title */ "Mise à jour du micrologiciel",
  /* ota.snapshot_label */ "État des données",
  /* ota.snapshot_value */ "Instantané",
  /* ota.snapshot_help */ "Dernier état reçu avant ce rechargement. Les données en direct peuvent s’interrompre pendant l’installation ; les paramètres restent verrouillés jusqu’au redémarrage.",
  /* ota.reload_hint */ "installée — rechargez la page",
  /* ota.dialog_title */ "Mise à jour du micrologiciel",
  /* ota.switch_title */ "Changer de version du micrologiciel",
  /* ota.changes_title */ "Modifications de cette mise à jour",
  /* ota.no_changes */ "Aucun journal des modifications n’a été fourni pour cette mise à jour.",
  /* ota.install_help */ "L’appareil télécharge et installe l’image signée, puis redémarre. Si le nouveau micrologiciel ne parvient pas à se connecter, l’appareil restaure automatiquement la version actuelle.",
  /* ota.switch_help */ "Cette version est plus ancienne car un autre canal de mise à jour est sélectionné. Sa signature est vérifiée avant l’installation. Si elle ne parvient pas à se connecter, l’appareil restaure automatiquement la version actuelle.",
  /* ota.install */ "Installer la mise à jour",
  /* ota.switch */ "Installer l’ancienne version",
  /* aria.ota */ "Rechercher les mises à jour du micrologiciel",
  /* ota.title_check */ "Touchez pour rechercher les mises à jour du micrologiciel",
  /* ota.title_avail */ (v) => `Mise à jour v${v} disponible — touchez pour installer`,
  /* mq.err_format */ "Saisissez hôte:port — p. ex. 192.168.1.10:1883 — ou mqtts://host:8883 pour TLS",
  /* sl.err_port */ "Le port doit être un nombre entier compris entre 1 et 65535 (p. ex. logs.example.com:514).",
  /* btn.saving */ "Enregistrement…",
  /* btn.verifying */ "Vérification…",
  /* btn.save */ "Enregistrer",
  /* btn.cancel */ "Annuler",
  /* btn.close */ "Fermer",
  /* schem.card_aria */ "Schéma en direct du système : unité extérieure, circuit frigorifique, échangeur à plaques, circuit d'eau avec chauffage d'appoint et vanne 3 voies, ballon ECS et circuit des locaux",
  /* schem.group_aria */ "Schéma en direct — sélectionnez une valeur ou un composant pour obtenir une explication",
  /* schem.outdoor_unit */ "UNITÉ EXTÉRIEURE",
  /* schem.defrost_pill */ "❄ dégivrage",
  /* schem.outdoor */ "Extérieur",
  /* insp.close */ "Fermer",
  /* schem.defrost_transfer */ "Pendant un dégivrage confirmé, la chaleur peut passer de l’eau au fluide frigorigène. Les tuyaux n’indiquent ce sens que si le débit et les températures actuels le confirment.",
  /* schem.leaving_water */ "R1T",
  /* schem.dhw_tank */ "BALLON ECS",
  /* schem.set */ "consigne",
  /* schem.bsh_label */ "Résistance",
  /* schem.space_circuit */ "CIRCUIT LOCAUX",
  /* schem.heating */ "CHAUFFAGE",
  /* schem.cooling */ "FROID",
  /* schem.pump */ "POMPE",
  /* schem.return */ "R4T",
  /* schem.room */ "Pièce",
  /* schem.flow_rate */ "débit",
  /* schem.water_press */ "pression",
  /* schem.r2t */ "R2T",
  /* schem.r3t */ "R3T",
  /* schem.flow_switch */ "FLUXOSTAT",
  /* schem.valve2 */ "2WV",
  /* wifi.title */ "Configuration WiFi",
  /* wifi.ssid */ "Réseau WiFi (SSID)",
  /* wifi.pass */ "Mot de passe WiFi",
  /* wifi.err_ssid */ "Le SSID doit contenir de 1 à 32 octets UTF-8",
  /* wifi.err_pass */ "Le mot de passe doit être vide (réseau ouvert) ou contenir de 8 à 63 octets UTF-8",
  /* wifi.hint */ "Saisissez le nom du réseau WiFi. Si l’appareil ne peut pas se connecter, il restaure automatiquement les paramètres WiFi précédents.",
  /* mqtt.title */ "Broker MQTT",
  /* mqtt.hostport */ "Hôte : port",
  /* mqtt.user */ "Nom d’utilisateur · facultatif",
  /* mqtt.pass */ "Mot de passe · facultatif",
  /* mqtt.clear */ "Supprimer les identifiants enregistrés — connexion anonyme",
  /* mqtt.hint */ "Un nom d’utilisateur ou un mot de passe exige une connexion TLS chiffrée (mqtts://, par exemple mqtts://host:8883). Laissez l’hôte vide pour désactiver MQTT.",
  /* mqtt.base */ "Sujet de base",
  /* mqtt.base_hint */ "Un sujet de base par appareil. Une deuxième carte sur ce broker a besoin du sien, sinon les deux partagent leurs sujets, leurs mesures et leur appareil Home Assistant. Le modifier renomme cette installation dans Home Assistant et laisse les anciens sujets conservés sur le broker.",
  /* err.mqtt_base_too_long */ "Le sujet de base est trop long.",
  /* err.mqtt_base_wildcard */ "Un sujet de base ne peut pas contenir + ou # — ce sont des caractères génériques d’abonnement et un broker refuse d’y publier.",
  /* err.mqtt_base_reserved */ "Un sujet de base ne peut pas commencer par $ — cette arborescence appartient au broker lui-même.",
  /* err.mqtt_base_slash */ "Un sujet de base ne peut pas commencer ni finir par une barre oblique.",
  /* err.mqtt_base_control */ "Un sujet de base ne peut pas contenir de caractères de contrôle.",
  /* err.mqtt_base_space */ "Un sujet de base ne peut pas contenir d’espaces.",
  /* err.mqtt_base_empty_segment */ "Un sujet de base ne peut pas contenir de segment vide (//).",
  /* err.mqtt_base_not_sluggable */ "Un sujet de base doit contenir au moins une lettre ou un chiffre — il devient l’ID d’appareil Home Assistant de cette installation et, sans lui, deux appareils entreraient en conflit.",
  /* mqtt.err.waiting_x10a */ "Aucune réponse de la pompe à chaleur sur X10A pour le moment — vérifiez le câblage, GND et les broches RX/TX.",
  /* mqtt.err.task_alloc */ "La tâche MQTT n’a pas pu démarrer — redémarrez l’appareil et vérifiez les diagnostics.",
  /* mqtt.err.transport */ "La connexion TLS/TCP au broker a échoué.",
  /* mqtt.err.refused */ "Le broker a refusé la connexion — vérifiez le nom d’utilisateur et le mot de passe.",
  /* mqtt.err.connection */ "La connexion au broker MQTT a échoué.",
  /* dyn.state_gate */ "État de l’installation inconnu",
  /* dyn.state_mode */ "Mode chauffage/rafraîchissement inconnu",
  /* env.title */ "Capteur extérieur",
  /* env.card */ "Climat extérieur",
  /* env.none */ "Aucun capteur",
  /* env.temperature */ "Température",
  /* env.humidity */ "Humidité",
  /* env.pressure */ "Pression atmosphérique",
  /* env.sensor_state */ "Capteur",
  /* env.live */ "En direct",
  /* env.collecting */ "Collecte…",
  /* env.history_title */ "Mesures ENV III",
  /* env.history_help */ "La température, l’humidité et la pression atmosphérique sont conservées sur l’ESP32 sous forme de tendances glissantes sur 24 heures, à intervalles de cinq minutes.",
  /* env.history_scales */ "échelles individuelles",
  /* env.unavailable */ "Capteur indisponible",
  /* env.err_pins */ "SDA et SCL doivent être des broches valides différentes",
  /* env.saving */ "Enregistrement de la configuration du capteur extérieur…",
  /* env.checking */ "Vérification d’ENV III…",
  /* env.err_not_reachable */ "ENV III est actuellement injoignable sur ces broches SDA/SCL.",
  /* env.err_sht30 */ "Le capteur de température/humidité ENV III est injoignable sur ces broches.",
  /* env.err_qmp6988 */ "Le capteur de pression ENV III est injoignable sur ces broches.",
  /* env.err_disable_first */ "Sélectionnez Aucun capteur et enregistrez avant de modifier les broches SDA/SCL.",
  /* env.pins_hint */ "SDA = données (fil Grove jaune) ; SCL = horloge (fil Grove blanc). Si les deux GPIO sélectionnés sont inversés, le micrologiciel vérifie l’ordre opposé et enregistre automatiquement l’affectation fonctionnelle.",
  /* env.atoms3_header_hint */ "AtomS3 Lite : utilisez deux des broches proposées — le connecteur du boîtier comporte GPIO5–GPIO8 et GPIO38. Le port Grove (GPIO2/1) n’apparaît que lorsque la liaison X10A ne l’utilise pas : un même contact ne peut pas transporter à la fois la liaison série et le bus I2C. GPIO39 n’est pas disponible pour ENV III.",
  /* circ.title */ "Source de la pompe de circulation",
  /* circ.row */ "Pompe de circulation ECS",
  /* circ.default_name */ "Pompe de circulation",
  /* circ.name */ "Nom",
  /* circ.topic */ "Sujet MQTT",
  /* circ.power_path */ "Chemin JSON de puissance",
  /* circ.time_path */ "Chemin JSON d’horodatage",
  /* circ.power_help */ "Puissance active réelle en watts ; la sortie du relais n’est pas utilisée.",
  /* circ.time_help */ "Heure de mesure au format RFC3339 ou en secondes Unix.",
  /* circ.on_threshold */ "Marche dès · W",
  /* circ.off_threshold */ "Arrêt jusqu’à · W",
  /* circ.max_age */ "Ancienneté maximale · secondes",
  /* circ.confirm */ "Confirmation · secondes",
  /* circ.hint */ "Lecture seule. L’enregistrement teste d’abord une valeur MQTT récente et ne commute jamais la prise.",
  /* circ.settings_help */ "La carte corrèle la puissance réelle de la pompe avec des fenêtres propres d’une heure de refroidissement du ballon. Elle observe uniquement et ne commute jamais la prise.",
  /* circ.not_configured */ "Non configuré",
  /* circ.unavailable */ "Indisponible",
  /* circ.broker_off */ "Aucun broker MQTT",
  /* circ.running */ "En marche",
  /* circ.stopped */ "Arrêtée",
  /* circ.checking */ "Vérification",
  /* circ.stale */ "Périmé",
  /* circ.waiting */ "En attente d’un message",
  /* circ.detail.source */ "Source",
  /* circ.detail.power */ "Puissance active",
  /* circ.detail.state */ "État détecté",
  /* circ.detail.age */ "Ancienneté de la mesure",
  /* circ.delete */ "Supprimer",
  /* circ.deleting */ "Suppression…",
  /* circ.deleted */ "Source de la pompe de circulation supprimée",
  /* circ.saved */ "Source de la pompe de circulation enregistrée",
  /* circ.test_failed */ "Aucune valeur récente et lisible de puissance de la pompe reçue",
  /* circ.err_topic */ "Saisissez un sujet MQTT exact sans les caractères génériques + ou #",
  /* circ.err_power_path */ "Saisissez le chemin JSON de puissance active, par exemple apower",
  /* circ.err_time_path */ "Saisissez le chemin JSON d’horodatage, par exemple aenergy.minute_ts",
  /* circ.err_max_age */ "L’ancienneté maximale doit être un nombre entier compris entre 10 et 3600 secondes",
  /* circ.err_confirm */ "La confirmation doit être un nombre entier compris entre 1 et 600 secondes",
  /* circ.err_threshold */ "Les seuils de puissance doivent comporter au maximum une décimale",
  /* circ.err_order */ "Le seuil de marche doit dépasser le seuil d’arrêt",
  /* syslog.title */ "Serveur Syslog",
  /* syslog.hostport */ "Hôte : port",
  /* syslog.hint */ "Saisissez le serveur Syslog sous forme de nom d’hôte ou d’adresse IP avec son port. Laissez le champ vide pour désactiver Syslog.",
  /* ntp.title */ "Serveur NTP",
  /* ntp.server */ "Serveur",
  /* ntp.hint */ "Saisissez le nom d’hôte ou l’adresse IP du serveur de temps. Laissez le champ vide pour utiliser la valeur par défaut du micrologiciel.",
  /* homehub.title */ "Modbus",
  /* homehub.host */ "Hôte · IP ou nom .local",
  /* homehub.port */ "Port",
  /* homehub.unit */ "ID d’unité",
  /* homehub.hint */ "Un micrologiciel neuf effectue automatiquement une recherche une fois lors de son premier démarrage en réseau et enregistre le résultat. La recherche peut aussi être lancée manuellement ici. Enregistrez le résultat ou saisissez une adresse manuellement. L’enregistrement d’une adresse vide désactive HomeHub définitivement : aucune future recherche automatique, aucune requête Modbus et aucun diagnostic dépendant. Le port par défaut est 502 et l’ID d’unité, 1. Cette boîte de dialogue configure uniquement la source de données ; elle n’offre aucun pilotage de la pompe à chaleur.",
  /* hh.search */ "Rechercher",
  /* hh.searching */ "Recherche…",
  /* hh.found */ (host) => `HomeHub trouvé : ${host}`,
  /* hh.not_found */ "Aucun HomeHub trouvé — saisissez l’adresse manuellement.",
  /* hh.saved */ "Paramètres Modbus enregistrés",
  /* hh.err_port */ "Le port doit être compris entre 1 et 65535",
  /* hh.err_unit */ "L’ID d’unité doit être compris entre 1 et 247",
  /* board.title */ "Matériel de la carte",
  /* board.ledtype */ "LED d’état",
  /* board.none */ "Aucun",
  /* board.reset_section */ "Bouton de réinitialisation",
  /* board.env3_section */ "ENV III · Capteur extérieur",
  /* board.preset */ "Carte",
  /* board.preset_custom */ "Personnalisée",
  /* board.not_selected */ "Non sélectionnée",
  /* board.led_gpio */ "LED simple (GPIO)",
  /* board.led_ws2812 */ "RGB adressable (WS2812)",
  /* board.ledpin */ "Broche de la LED",
  /* board.btnpin */ "Broche du bouton de réinitialisation",
  /* board.ledlegend_rgb */ "Couleurs de la LED et motifs de clignotement",
  /* board.ledlegend_gpio */ "Motifs de clignotement de la LED",
  /* board.led_rgb_off */ "Éteinte — aucun réseau actif.",
  /* board.led_rgb_setup */ "Bleue, clignotement lent — portail de configuration actif.",
  /* board.led_rgb_connecting */ "Jaune, clignotement rapide — connexion au réseau.",
  /* board.led_rgb_healthy */ "Verte fixe — X10A et, si configuré, MQTT connectés.",
  /* board.led_rgb_bus_down */ "Rouge, double flash — X10A déconnecté ou mode de récupération.",
  /* board.led_rgb_mqtt_down */ "Orange, clignotante — X10A connecté, MQTT déconnecté.",
  /* board.led_rgb_wipe_armed */ "Rouge, clignotement très rapide — effacement armé ; relâchez pour annuler.",
  /* board.led_rgb_wiping */ "Blanche fixe — réinitialisation/effacement en cours ; ne coupez pas l’alimentation.",
  /* board.led_gpio_off */ "Éteinte — aucun réseau actif.",
  /* board.led_gpio_setup */ "Clignotement lent — portail de configuration actif.",
  /* board.led_gpio_connecting */ "Clignotement rapide — connexion au réseau.",
  /* board.led_gpio_healthy */ "Fixe — X10A et, si configuré, MQTT connectés.",
  /* board.led_gpio_bus_down */ "Double flash — X10A déconnecté ou mode de récupération.",
  /* board.led_gpio_mqtt_down */ "Clignotement à vitesse moyenne — X10A connecté, MQTT déconnecté.",
  /* board.led_gpio_wipe_armed */ "Clignotement très rapide — effacement armé ; relâchez pour annuler.",
  /* board.led_gpio_wiping */ "Fixe après clignotement très rapide — réinitialisation/effacement en cours ; ne coupez pas l’alimentation.",
  /* board.ledinv */ "Actif au niveau bas (la LED s’allume lorsque la broche est commandée LOW)",
  /* board.btninv */ "Actif au niveau bas (le bouton relie la broche à GND)",
  /* board.hint */ "Pour rétablir les réglages d’usine, maintenez le bouton enfoncé 5 s. La réinitialisation n’efface rien si le journal d’historique n’est pas prêt. Elle efface les réglages Wi-Fi et les autres paramètres, l’historique enregistré, les durées d’état, le vidage mémoire brut après un plantage et le registre sauvegardé pour le nettoyage MQTT. Les réglages de la carte, de la LED et du bouton sont conservés si possible. En cas d’échec d’un effacement, une partie des données peut déjà avoir été effacée. L’appareil ne redémarre que si tous les effacements réussissent. Si la réinitialisation ne démarre pas ou ne se termine pas, consultez /diag. Si aucun bouton n’est raccordé, choisissez « Aucun ».",
  /* card.hardware */ "Matériel",
  /* card.hw_led */ (pin, kind) => `GPIO${pin} · ${kind}`,
  /* card.hw_btn */ (pin) => `GPIO${pin}`,
  /* card.hw_board_m5stack */ "La M5Stack AtomS3 Lite est une carte ESP32-S3 compacte dotée d’une LED d’état RGB WS2812 intégrée.",
  /* card.hw_board_seeed */ "La Seeed XIAO ESP32-S3 est une carte ESP32-S3 compacte de Seeed Studio.",
  /* card.hw_board_other */ (name) => `Carte sélectionnée : ${name}.`,
  /* card.hw_active_low */ "actif au niveau LOW",
  /* card.hw_active_high */ "actif au niveau HIGH",
  /* card.hw_led_detail */ (kind, pin, active) => `${kind} sur GPIO${pin}${active ? `, ${active}` : ""}.`,
  /* card.hw_led_disabled */ "Non configurée.",
  /* card.hw_btn_detail */ (pin, active) => `GPIO${pin}, ${active}.`,
  /* card.hw_btn_disabled */ "Non configuré.",
  /* card.hw_env_detail */ (sda, scl) => `SDA sur GPIO${sda}, SCL sur GPIO${scl}.`,
  /* card.hw_env_disabled */ "Non configuré.",
  /* card.firmware */ "Version",
  /* card.channel */ "Canal de mise à jour",
  /* card.firmware_help */ "Version actuellement exécutée sur l’ESP32. Touchez la valeur pour rechercher une image de micrologiciel signée sur le canal de mise à jour sélectionné.",
  /* card.channel_help */ "Stable suit les versions stables publiées manuellement. Développement suit la dernière fusion pertinente pour le micrologiciel. La modification du canal interroge immédiatement ce flux.",
  /* chan.release */ "Stable",
  /* chan.dev */ "Développement",
  /* chan.saved */ (c) => `Canal de mise à jour : ${c}`,
  /* card.proto_title */ "Protocole",
  /* card.fw_title */ "Micrologiciel",
  /* settings.diagnostics */ "Diagnostic de l’installation",
  /* card.language */ "Langue",
  /* card.language_help */ "Navigateur utilise la préférence linguistique du navigateur. Le choix d’une langue enregistre une langue d’interface fixe pour tout l’appareil.",
  /* card.diagnostics */ "Diagnostic de l’installation",
  /* card.diagnostics_help */ "Active la vérification de l’installation sur 24 heures et le suivi facultatif de la puissance de la pompe de circulation.",
  /* diagnostics.off */ "Désactivé",
  /* diagnostics.saved_on */ "Diagnostic de l’installation activé — la collecte commence maintenant",
  /* diagnostics.saved_off */ "Diagnostic de l’installation désactivé — collecte arrêtée",
  /* probe.toggle */ "Diagnostic du protocole",
  /* probe.intro */ "Lecture directe d’une page de registres X10A avec évaluation facultative du convertisseur.",
  /* probe.request */ "Requête",
  /* probe.register */ "Registre",
  /* probe.manual */ "Saisie manuelle",
  /* probe.page */ "Page de registres",
  /* probe.offset */ "Décalage dans la charge utile",
  /* probe.size */ "Largeur du champ",
  /* probe.byte */ "octet",
  /* probe.bytes */ "octets",
  /* probe.converter */ "Convertisseur",
  /* probe.page_help */ "Hexadécimal ou décimal · 0…255",
  /* probe.offset_help */ "Indice dans la charge utile · 0…31",
  /* probe.size_help */ "Octets à décoder",
  /* probe.converter_auto */ "Automatique",
  /* probe.converter_auto_help */ size=>`Teste tous les convertisseurs implémentés pour ${size} octet${Number(size)===1?"":"s"}.`,
  /* probe.conv_raw_byte */ "octet brut · 0…255",
  /* probe.conv_unsigned_byte */ "octet non signé",
  /* probe.conv_tenth_byte */ "octet brut × 0,1",
  /* probe.conv_unsigned_half_byte */ "octet non signé × 0,5",
  /* probe.conv_signed_raw_le */ "entier signé · little-endian",
  /* probe.conv_signed_raw_be */ "entier signé · big-endian",
  /* probe.conv_signed_256_le */ "signé ÷ 256 · little-endian",
  /* probe.conv_signed_256_be */ "signé ÷ 256 · big-endian",
  /* probe.conv_signed_tenth_le */ "signé × 0,1 · little-endian",
  /* probe.conv_signed_tenth_be */ "signé × 0,1 · big-endian",
  /* probe.conv_signed_tenth_nodata_le */ "signé × 0,1 · little-endian · 0x8000 = aucune donnée",
  /* probe.conv_signed_tenth_nodata_be */ "signé × 0,1 · big-endian · 0x8000 = aucune donnée",
  /* probe.conv_signed_128_le */ "signé ÷ 256 × 2 · little-endian",
  /* probe.conv_signed_128_be */ "signé ÷ 256 × 2 · big-endian",
  /* probe.conv_signed_half_be */ "signé × 0,5 · big-endian",
  /* probe.conv_signed_hundredth_be */ "signé × 0,01 · big-endian",
  /* probe.conv_unsigned_raw_le */ "entier non signé · little-endian",
  /* probe.conv_unsigned_raw_be */ "entier non signé · big-endian",
  /* probe.conv_unsigned_half_be */ "non signé × 0,5 · big-endian",
  /* probe.conv_saturation */ "pression → température de saturation",
  /* probe.conv_raw_fan */ "octet brut / niveau du ventilateur",
  /* probe.conv_capacity */ "code de capacité de l’unité intérieure",
  /* probe.conv_eeprom_digit */ "chiffre EEPROM brut",
  /* probe.conv_eeprom_pair */ "paire de chiffres EEPROM bruts",
  /* probe.conv_bits_high */ "bits 4–6 · compteur 3 bits",
  /* probe.conv_bits_low */ "bits 0–2 · compteur 3 bits",
  /* probe.conv_operation_mode */ "mode de fonctionnement",
  /* probe.conv_error_class */ "classe d’erreur",
  /* probe.conv_error_code */ "code d’erreur Daikin",
  /* probe.conv_indoor_mode */ "mode unité intérieure · quartet haut",
  /* probe.conv_hybrid_mode */ "mode hybride",
  /* probe.conv_bit */ bit=>`bit ${bit} · 0 ou 1`,
  /* probe.conv_unknown */ "convertisseur inconnu",
  /* probe.send */ "Lire le registre",
  /* probe.querying */ "Interrogation…",
  /* probe.action_note */ "Une requête par cycle de scrutation. Bloquée pendant l’OTA.",
  /* probe.catalog_loading */ "Chargement du profil actif…",
  /* probe.catalog_empty */ "Aucune définition de registre disponible.",
  /* probe.catalog_error */ "Impossible de charger les registres du profil.",
  /* probe.catalog_profile */ profile=>`Profil : ${profile}`,
  /* probe.catalog_fallback */ (definition,profile)=>`main/def : ${definition} · profil : ${profile}`,
  /* probe.response */ "Réponse",
  /* probe.frame */ "Trame",
  /* probe.payload */ "Charge utile",
  /* probe.slice */ "Octets sélectionnés",
  /* probe.interpretation */ "Interprétation",
  /* probe.response_for */ reg=>`Réponse du registre ${reg}`,
  /* probe.payload_marked */ "Charge utile · octets sélectionnés marqués",
  /* probe.slice_note */ (offset,size,slice)=>`Décalage ${offset} · ${size} octet${size===1?"":"s"} · 0x${String(slice).replace(/\s+/g,"")}`,
  /* probe.full_frame */ "Trame complète",
  /* probe.decode_value */ "Résultat du convertisseur",
  /* probe.no_decodes */ "Aucun résultat du convertisseur.",
  /* probe.refused */ "Valeur rejetée",
  /* probe.unimplemented */ "Non implémenté",
  /* probe.aliases */ "aussi",
  /* probe.invalid */ "Vérifiez la page, le décalage, la largeur du champ et le convertisseur.",
  /* probe.failed */ "Échec de la requête.",
  /* probe.status_ok */ "Réponse valide",
  /* probe.status_busy */ "Occupé",
  /* probe.status_no_link */ "Aucune liaison X10A",
  /* probe.status_timeout */ "Délai dépassé",
  /* probe.status_no_reply */ "Aucune réponse",
  /* probe.status_rejected */ "Rejeté",
  /* probe.status_bad_crc */ "Somme de contrôle incorrecte",
  /* probe.status_unexpected_reply */ "Réponse inattendue",
  /* probe.status_invalid_length */ "Longueur invalide",
  /* probe.status_short_reply */ "Réponse partielle",
  /* probe.status_out_of_bounds */ "Hors charge utile",
  /* probe.status_error */ "Erreur",
  /* probe.transport_ok */ "Trame complète et valide.",
  /* probe.transport_busy */ "Une autre requête de registre est active.",
  /* probe.transport_no_link */ "La liaison X10A n’est pas disponible.",
  /* probe.transport_timeout */ "La tâche de scrutation n’a pas exécuté la requête à temps.",
  /* probe.transport_no_reply */ "Aucun octet de réponse reçu.",
  /* probe.transport_rejected */ "L’unité a rejeté cette page de registres.",
  /* probe.transport_bad_crc */ "Réponse reçue ; somme de contrôle invalide.",
  /* probe.transport_unexpected_reply */ "La réponse appartient à une autre page de registres.",
  /* probe.transport_invalid_length */ "La réponse annonce une longueur de trame invalide.",
  /* probe.transport_short_reply */ "Seule une partie de la réponse a été reçue.",
  /* probe.transport_out_of_bounds */ "Les octets demandés sont hors de cette charge utile.",
  /* probe.transport_error */ "Échec de la requête.",
  /* lang.auto */ "Navigateur",
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
  /* lang.saved */ "Langue enregistrée",
  /* check.detail.dhw_reason.blind_modbus */ "relevés manquants : Modbus sans réponse ou interrogation en pause",
  /* check.detail.source_stale_modbus */ "Pas de mesure Modbus récente ; état actuel inconnu. Historique conservé.",
  /* mb.flow_scale_help */ "Échelle /100 non confirmée (sonde/repli) ; comparez L/min à l’afficheur. Exclu du flux, ΔT, puissance et bilan 24 h.",
  /* hist.modbus_flow_unverified */ "Échelle Modbus /100 non vérifiée (sonde/repli) ; comparez à l’unité.",
]);
INSPECT_I18N.fr = inspectValues(
  ["Aucun relevé actuel :", "le compresseur est arrêté et l’unité extérieure n’actualise ses propres capteurs qu’en fonctionnement. La valeur du dernier cycle est masquée pour ne pas la présenter comme actuelle.", "Vitesse du compresseur illisible : les valeurs de l’unité extérieure peuvent venir du dernier cycle."],
  [
    ["Mode de fonctionnement", 0, "Mode de l’unité intérieure. Il ne confirme à lui seul ni compresseur ni débit."], // status
    ["Climat extérieur", "Climat extérieur ENV III", "Température, humidité et pression de l’ENV III ; son emplacement conditionne la mesure extérieure."], // env3
    [(d) => d && d.sgSrc === "X10A" ? "Demande Smart Grid · X10A" : "Demande Smart Grid · Modbus", "Demande Smart Grid", (d) => d && d.sgSrc === "X10A"
      ? "Ordre externe indiqué par les contacts physiques SG-Ready : Libre, Arrêt forcé, Marche recommandée ou Marche forcée. Ce n’est ni le mode chauffage/froid ni la preuve qu’une charge du ballon a commencé ; un ordre envoyé par le réseau peut ne pas apparaître sur ces contacts."
      : "Ordre externe relu depuis le HomeHub : Libre, Arrêt forcé, Marche recommandée ou Marche forcée. Ce n’est ni le mode chauffage/froid ni la preuve qu’une charge du ballon a commencé.", (d) => !d || d.sgMode == null
      ? "Aucune valeur Smart Grid actuelle."
      : d.sgMode === 2 && d.sgSrc === "X10A"
      ? "Les contacts SG-Ready indiquent Marche recommandée, l’état utilisé par des gestionnaires comme evcc pour le renfort. Mode ECS, vanne 3 voies et débit montrent séparément si le ballon charge réellement."
      : d.sgMode === 2
      ? "Le HomeHub indique Marche recommandée, l’état utilisé par des gestionnaires comme evcc pour le renfort. Mode ECS, vanne 3 voies et débit montrent séparément si le ballon charge réellement."
      : d.sgMode === 1 ? "Le gestionnaire d’énergie signale « arrêt forcé »."
      : d.sgMode === 3 ? "Le gestionnaire d’énergie signale « marche forcée »."
      : "Aucune demande Smart Grid externe ; l’unité fonctionne de façon autonome."], // sgrequest
    ["Unité extérieure", 0, "Côté source de chaleur d’une installation air/eau. Le ventilateur déplace l’air sur l’échangeur et le compresseur élève pression et température du fluide frigorigène. Schéma fonctionnel simplifié : monoblocs, géothermie et hybrides ont une autre disposition.", (d) => d.defrost
      ? "Dégivrage actif : le circuit s’inverse pour retirer la glace de l’évaporateur et reprend brièvement de la chaleur à l’eau."
      : compressorRunning(d)
      ? d.rps != null
        ? `En marche : compresseur à ${fmt0(d.rps)} rps${d.quiet ? ", limité par le mode silencieux" : ""}.`
        : "En marche : le HomeHub confirme le compresseur actif ; vitesse et mesures détaillées exigent X10A."
      : d.ouHeldOver && d.mbFields && d.mbFields.has("out")
      ? "En veille : compresseur arrêté. X10A n’actualise plus les capteurs extérieurs ; l’air extérieur vient du registre Modbus, le refoulement reste « — » et l’âge réel de cette mesure est inconnu."
      : "En veille : compresseur arrêté, sans transfert actif. Les capteurs propres à l’unité extérieure restent « — » pour ne pas répéter les valeurs du dernier cycle."], // ou
    ["Compresseur", 0, "Comprime le fluide frigorigène pour augmenter sa pression et sa température. La fréquence en rps indique la vitesse, pas à elle seule la puissance thermique ou électrique."], // comp
    ["Air extérieur", 0, "Température au capteur extérieur. Au repos, X10A peut la retenir ; elle est alors masquée ou HomeHub est identifié."], // out
    ["Échangeur extérieur · R4T", "Température de l’échangeur extérieur R4T", "Température de l’échangeur extérieur. En chauffage il peut passer sous zéro et givrer ; lire cette valeur avec l’état de dégivrage."], // ouhx
    ["Haute pression", 0, "Pression du côté haute pression du circuit frigorifique. La valeur peut venir du transducteur du compresseur en marche ou du capteur utilisable au repos ; ce n’est pas la pression d’eau."], // hp
    ["Température de refoulement", 0, "Température du gaz à la sortie du compresseur. X10A conserve la valeur du dernier cycle à l’arrêt ; le relevé actuel est donc masqué au repos."], // disch
    ["Basse pression", 0, "Pression du fluide frigorigène côté basse pression du compresseur, après détente en chauffage. Certains profils n’ont pas de transducteur exploitable ; « — » apparaît alors."], // lp
    ["Détendeur", 0, "Dose le fluide frigorigène et abaisse sa pression. La position est exprimée en impulsions de commande, pas en pourcentage ni comme retour mécanique d’ouverture."], // eev
    ["Liquide frigorigène · R3T", "Température du liquide frigorigène R3T", "Température du fluide frigorigène côté liquide de l’échangeur intérieur. Ce n’est pas la température de retour d’eau."], // r3t
    ["Échangeur à plaques", 0, "Transfère l’énergie entre fluide frigorigène et eau sans les mélanger. La puissance affichée est estimée avec débit et R1T/R4T ; la position physique exacte de ces capteurs dépend du modèle.", (d) => !compressorRunning(d, 5)
      ? "Aucun transfert frigorifique actif : compresseur arrêté. La pompe peut redistribuer de la chaleur résiduelle, mais ce n’est ni une puissance de chauffage ni de froid."
      : d.dtStale ? "Transfert à l’eau non calculable : pompe et débit ne prouvent aucun mouvement dans les plaques."
      : d.pth == null ? "Les mesures ne permettent pas d’estimer un transfert utile dans le sens du mode sélectionné."
      : d.pthKind === "cooling" ? `Environ ${fmt1(d.pth)} kW retirés à l’eau : ${fmt1(d.flow)} l/min avec ΔT ${fmt1(d.dt)} K.`
      : `Environ ${fmt1(d.pth)} kW transmis à l’eau : ${fmt1(d.flow)} l/min avec ΔT ${fmt1(d.dt)} K.`], // phe
    ["Sortie PHE · avant BUH · R1T", "Sortie d’eau PHE avant BUH R1T", "Température de l’eau à la sortie du PHE avant l’appoint électrique. Elle n’inclut pas la chaleur ajoutée ensuite par le BUH."], // lwt
    ["Départ après BUH · R2T", "Départ d’eau après BUH R2T", "Température d’eau mesurée après le BUH. Contrairement à R1T, elle peut inclure sa chaleur électrique ; sa position exacte par rapport à pompe et vannes dépend de l’unité hydraulique."], // r2t
    ["Entrée PHE · R4T", "Entrée d’eau PHE R4T", "Température de l’eau revenant au PHE. C’est un capteur interne du circuit hydraulique, pas un capteur dédié sur les émetteurs du bâtiment."], // rwt
    ["ΔT eau au PHE", "Delta T de l’eau au PHE", "R1T à la sortie du PHE moins R4T à l’entrée. Calculé à partir de deux capteurs ; avec le débit il décrit le transfert, sans mesurer directement départ et retour aux émetteurs.", (d) => d.dtStale ? "Aucun ΔT de travail : pompe et débit ne prouvent pas la circulation. Sans mouvement, l’écart entre capteurs n’est pas un point de fonctionnement."
      : d.dt == null ? null
      : !compressorRunning(d, 5) ? `${fmt1(d.dt)} K avec pompe seule : égalisation de chaleur résiduelle, pas puissance thermique.`
      : d.thermalMode === "cool" ? `${fmt1(d.dt)} K. En froid actif R1T doit être sous R4T ; la différence signée est donc négative.`
      : `${fmt1(d.dt)} K. Positif signifie que le PHE apporte de la chaleur à l’eau.`], // dt
    [(d) => d && d.pthKind === "cooling" ? "Puissance froid estimée" : "Puissance thermique estimée", "Puissance thermique estimée au PHE", (d) => d && d.pthKind === "cooling"
      ? "Estimation de la chaleur retirée : débit/60 × (R4T−R1T) × ρ·cp (≈ 4,186 kJ/(l·K)) en supposant de l’eau. Dépend du débit, des capteurs et du fluide ; le glycol change le calcul. Affichée seulement avec compresseur en marche et écart dans le sens froid."
      : "Estimation de la chaleur transmise : débit/60 × (R1T−R4T) × ρ·cp (≈ 4,186 kJ/(l·K)) en supposant de l’eau. Dépend du débit, des capteurs et du fluide ; le glycol change le calcul. Le BUH est après R1T et hors de cette valeur.", (d) => d.dtStale ? d.bsh === true
      ? "Aucun transfert calculable au PHE faute de circulation établie. La résistance interne peut encore chauffer le ballon, mais sa chaleur ne traverse pas R1T/R4T et ce bus ne peut pas la chiffrer."
      : "Aucune puissance calculable faute de mouvement d’eau établi au PHE. Il manque un point de travail ; cela ne signifie pas 0 kW."
      : d.pth == null ? null
      : d.pthKind === "cooling" ? `≈ ${fmt1(d.pth)} kW de froid${d.cop != null ? ` ; EER ${fmt1(d.cop)}` : ""}.`
      : `≈ ${fmt1(d.pth)} kW${d.cop != null && !d.copPostBuh ? ` ; COP ${fmt1(d.cop)}` : ""}.`], // pth
    [(d) => d && d.efficiencyKind === "eer" ? "EER estimé de la pompe à chaleur" : d && d.copScope === "plant" ? "COP estimé après BUH" : "COP estimé de la pompe à chaleur", "Rendement estimé", (d) => d && d.efficiencyKind === "eer"
      ? "Puissance froid estimée divisée par entrée électrique estimée. Hérite des incertitudes du fluide, des capteurs, de la tension et du facteur de puissance. EER instantané, non saisonnier ; l’énergie mesurée sur une saison est plus parlante."
      : "Puissance thermique estimée divisée par entrée électrique estimée, avec périmètres compatibles : après BUH avec CT et R2T, ou pompe à chaleur seule avec courant d’onduleur. Le câblage CT décide des charges incluses. Indication instantanée, pas compteur certifié.", (d) => d.copBlock === "tank_heater" ? "Aucun COP : la résistance du ballon peut être incluse dans l’électricité, mais sa chaleur va directement au ballon sans traverser les capteurs de départ ; les périmètres diffèrent."
      : d.copBlock === "buh_no_r2t" ? "Aucun COP : BUH actif sans capteur après lui. L’électricité peut inclure l’appoint alors que la chaleur est calculée avant."
      : d.copBlock === "mb_scope" ? "COP indisponible. Le guide HomeHub ne précise pas quelles charges électriques sont incluses. La chaleur estimée concerne l’échangeur à plaques. Le calcul du COP exige deux périmètres de mesure compatibles et vérifiés."
      : d.copBlock === "no_pel" ? d.pelHeld ? "Aucun COP : compresseur arrêté, le courant d’onduleur vient du dernier cycle et n’est pas actuel." : "Aucun COP : ce profil ne fournit ni courant CT ni courant d’onduleur."
      : d.cop == null ? null
      : d.efficiencyKind === "eer" ? `${fmt1(d.cop)} kW de froid par kW électrique : ≈ ${fmt1(d.copPth)} kW retirés pour ≈ ${fmt1(d.pel)} kW absorbés.`
      : d.copScope === "plant" ? `${fmt1(d.cop)} kW thermiques après BUH par kW électrique estimé par CT : ≈ ${fmt1(d.copPth)} / ≈ ${fmt1(d.pel)} kW. Le câblage CT fixe les charges incluses.`
      : `${fmt1(d.cop)} kW thermiques par kW électrique dans le périmètre pompe à chaleur : ≈ ${fmt1(d.copPth)} / ≈ ${fmt1(d.pel)} kW. Le BUH est hors des deux valeurs.`], // cop
    ["Chauffage d’appoint · BUH", "Chauffage d’appoint BUH", "Appoint électrique du circuit d’eau placé après R1T. Ses étages peuvent relever le départ et la consommation ; ce n’est pas la résistance interne BSH du ballon.", (d) => d.buh1 == null && d.buh2 == null ? null : d.buh2 ? "Étage 2 : les deux étages chauffent." : d.buh1 ? "Étage 1 : un étage chauffe." : "Inactif : aucun étage BUH ne chauffe."], // buh
    ["Résistance du ballon", "Résistance électrique du ballon", "Résistance d’immersion BSH dans le ballon. Elle peut chauffer avec compresseur, pompe et débit à zéro ; son contact X10A ne mesure aucune puissance.", () => { const on = x10aDown() ? null : vOn(/^bsh$/i); return on == null ? null : on ? "Résistance du ballon active." : "Inactive : résistance du ballon arrêtée."; }], // bsh
    ["Vanne 3 voies", 0, "La sortie logique sélectionne le ballon ou les locaux. Ce n’est ni un retour mécanique de position ni une confirmation de débit.", (d) => d.valveDhw == null ? null : d.valveDhw ? "La commande indique le ballon. Cela ne prouve ni position mécanique, ni débit, ni charge active." : "La commande indique les locaux. Cela ne prouve ni position mécanique ni circulation."], // valve
    ["Sortie vanne 2 voies", 0, "Sortie binaire X10A pour une 2WV du circuit locaux. Elle n’indique pas la position mécanique et n’équivaut pas au mode chauffage/froid.", (d) => d.valve2On == null ? null : d.valve2On ? "X10A indique la sortie 2WV active. Cela ne prouve ni chauffage actif ni position mécanique ; vérifier mode et fonctionnement des locaux." : "X10A indique la sortie 2WV inactive. Cela ne signifie pas à lui seul le froid et ne contredit pas un mode chauffage configuré, surtout au repos."], // valve2
    ["Ballon ECS", "Ballon ECS ou stockage thermique", "Ballon mesuré par R5T. Charge, consigne et résistance BSH sont affichées séparément."], // tank
    [(d) => activeSpaceKind(d) === "cool" ? "Circuit froid" : activeSpaceKind(d) === "heat" ? "Circuit chauffage" : "Circuit locaux", "Circuit des locaux", "Émetteurs du bâtiment : radiateurs, plancher ou ventilo-convecteurs. L’installation décide s’ils chauffent, refroidissent ou les deux ; R1T/R4T sont mesurés dans la pompe et ne confirment pas leur température.", (d) => d.valveDhw === true ? "Le chemin locaux n’est pas sélectionné ; pompe et débit indiquent séparément une éventuelle circulation vers le ballon."
      : waterMoving(d) ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0
        ? `De l’eau résiduelle chaude circule vers les locaux. R1T interne : ${degC(d.lwt)} ; aucun capteur aval ne confirme la température des émetteurs. Ce n’est pas du froid actif.`
        : `L’eau va vers le circuit ${activeSpaceKind(d) === "cool" ? "froid" : activeSpaceKind(d) === "heat" ? "chauffage" : "locaux"}. R1T interne : ${degC(d.lwt)} ; aucun capteur aux émetteurs.`
      : "Pompe et débit actuels ne prouvent aucune circulation dans la branche locaux."], // heat
    ["Fonctionnement des locaux", "Fonctionnement chauffage ou froid des locaux", "Signal de fonctionnement normal chauffage/froid des locaux. Ce n’est pas la demande du thermostat et il ne prouve pas à lui seul le fonctionnement du compresseur."], // spaceh
    ["Température ambiante", 0, "Température et consigne de la zone de référence ; elles dépendent du placement du capteur."], // room
    ["Circulateur", "Circulateur", "Signal X10A inversé (0 = max, 100 = arrêt, [0, 100] → 100–0 %) ; ne prouve ni RPM, ni rotation, hauteur ou débit. Lisez ON/OFF et débit séparément, même à l’arrêt.", (d) => pumpNowText(d, [(n) => `Commande pompe ${n} %.`, "État pompe ON.", "La pompe signale l’arrêt (OFF).", "État ON/OFF de la pompe inconnu.", (n) => `Débit mesuré ${n} l/min.`, "Aucune mesure de débit.", "L’état OFF signalé contredit le débit ; circulation externe, post-circulation ou signal obsolète possibles.", "Circulation non établie."])], // pump
    [(d) => pelMeasured(d) ? "Puissance électrique · HomeHub" : "Puissance électrique estimée", "Puissance électrique", (d) => pelMeasured(d)
      ? "Consommation annoncée par l’entrée HomeHub 51. L’UI ne la calcule pas, mais le guide public ne prouve ni étalonnage, ni point de mesure, ni appoints inclus ; ce n’est pas un compteur certifié de l’installation."
      : "Estimation pour COP/EER. Avec CT, toutes les phases déclarées sont sommées puis multipliées par 230 V supposés ; tension et facteur de puissance réels sont inconnus. Le courant d’onduleur ne couvre que le compresseur.", (d) => d.pelHeld ? "Compresseur arrêté : le courant d’onduleur vient du dernier cycle et n’est pas actuel ; puissance et rendement ne peuvent être indiqués."
      : d.pel == null ? "Ce profil n’a aucun relevé électrique actuel ; COP/EER ne peut pas être calculé."
      : d.pelSrc === "MB" ? "Annoncé par l’entrée HomeHub 51 ; le périmètre exact n’est pas documenté."
      : d.pelSrc === "CT" ? "Estimé par pinces CT ; les charges incluses dépendent du câblage."
      : "Calculé depuis le courant d’onduleur, compresseur seul."], // pel
    ["Dégivrage", 0, "Inverse temporairement le circuit pour retirer la glace de l’échangeur extérieur. Normal par temps froid et humide, il reprend brièvement de la chaleur à l’eau.", (d) => d.defrost == null ? null : d.defrost ? "Dégivrage actif." : "Inactif : aucun dégivrage en cours."], // defrost
    ["Mode silencieux", 0, "Mode limitant le bruit et généralement la vitesse ou puissance de l’unité extérieure. Le signal donne l’état du mode, pas son niveau exact ni son effet thermique.", (d) => d.quiet == null ? null : d.quiet ? "Mode silencieux actif." : "Inactif : mode silencieux arrêté."], // quiet
    ["Ligne gaz", "Ligne gaz frigorigène", "Ligne frigorifique entre unités dans le schéma split. En chauffage elle amène le gaz chaud haute pression au PHE ; en froid le sens s’inverse. Un monobloc n’a pas cette ligne de terrain.", (d) => compressorRunning(d) ? d.rps != null ? `En circulation : ${fmt1(d.circP)} bar à ${fmt0(d.disch)} °C.` : "En circulation : HomeHub confirme le compresseur ; pression et refoulement exigent X10A." : "Aucune circulation frigorifique active : compresseur arrêté. L’égalisation dépend du circuit et du temps d’arrêt."], // rhot
    ["Ligne liquide", "Ligne liquide frigorigène", "Ligne frigorifique entre unités dans le schéma split. En chauffage elle ramène le fluide condensé haute pression vers le détendeur extérieur ; en froid le sens s’inverse. Un monobloc n’a pas cette ligne.", (d) => compressorRunning(d) ? d.rps != null ? `En circulation : détendeur à ${fmt0(d.eev)} impulsions.` : "En circulation : HomeHub confirme le compresseur ; la position du détendeur exige X10A." : "Immobile : compresseur arrêté."], // rcold
    ["Tuyau de sortie PHE", "Tuyau de sortie du PHE", "Eau quittant le PHE à R1T puis passant par BUH, pompe et 3WV. En chauffage/ECS c’est le côté chaud, en froid actif le côté froid ; R1T est avant BUH et les branches.", (d) => waterMoving(d) ? `R1T avant BUH : ${degC(d.lwt)} à ${fmt1(d.flow)} l/min${d.buh1 || d.buh2 ? " ; un étage BUH est actif après" : ""}.` : "Pompe et débit ne prouvent aucune circulation dans ce tuyau."], // wsup
    ["Circuit ballon", "Circuit hydraulique du ballon", "Branche hydraulique chargeant le ballon ECS ou le stockage. L’échangeur interne dépend du modèle ; le dessin montre la fonction, pas sa construction exacte. Dans ce schéma dérivé, la charge interrompt le débit direct vers les locaux.", (d) => d.valveDhw === true ? waterMoving(d) ? `Chemin ballon sélectionné : ${fmt1(d.flow)} l/min, sortie PHE ${degC(d.lwt)}, ballon ${degC(d.tank)}.` : "Chemin ballon sélectionné, mais pompe et débit ne prouvent aucune charge active." : "Chemin ballon non sélectionné ; la commande indique les locaux."], // wtank
    [(d) => activeSpaceKind(d) === "cool" ? "Branche froid" : activeSpaceKind(d) === "heat" ? "Branche chauffage" : "Branche locaux", "Branche hydraulique des locaux", "Branche vers radiateurs, plancher, ventilo-convecteurs ou autres émetteurs. R1T/R4T sont mesurés dans l’unité hydraulique et ne prouvent ni la température de cette branche ni la charge du bâtiment.", (d) => d.valveDhw === true ? "Branche locaux non sélectionnée ; la commande indique le ballon."
      : waterMoving(d) ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0
        ? `Circulation de chaleur résiduelle vers les locaux à ${fmt1(d.flow)} l/min ; pas de froid actif. R1T ${degC(d.lwt)}, R4T ${degC(d.ret)} ; côté terrain non mesuré.`
        : `Circulation vers les locaux à ${fmt1(d.flow)} l/min. Capteurs internes : R1T ${degC(d.lwt)}, R4T ${degC(d.ret)}.`
      : "Pompe et débit ne prouvent aucune circulation dans la branche locaux."], // wheat
    ["Tuyau d’entrée PHE", "Tuyau d’entrée du PHE", "Retour commun au PHE par R4T après réunion des branches. En chauffage il est normalement plus froid que R1T, en froid actif plus chaud ; R4T n’est pas un capteur dédié aux émetteurs.", (d) => waterMoving(d) ? `Retour à ${degC(d.ret)}, ${fmt1(d.flow)} l/min et ${fmt1(d.wp)} bar.` : "Pompe et débit ne prouvent aucune circulation dans le retour."], // wret
    ["Débit", "Débit d’eau", "Débit du circuit commun. Le minimum dépend du modèle ; à lire avec pompe et pression."], // flow
    ["État du fluxostat", 0, "Entrée binaire X10A ; elle ne mesure pas les l/min ni le débit minimal.", (d) => d.flowSwitch == null ? null : d.flowSwitch ? `X10A actif ; comparer avec pompe et ${fmt1(d.flow)} l/min.` : `X10A inactif ; pompe active, comparer ${fmt1(d.flow)} l/min et défauts 7H/C0.`], // flow_switch
    ["Pression d’eau", 0, "Pression du circuit hydraulique, pas du fluide frigorigène. La plage admise dépend du modèle et de l’installation ; consulter le manuel exact."], // wp
  ],
);

HOMEHUB_LABEL_I18N.fr = homeHubValues([
  "Consigne de départ chauffage · zone principale", // 1
  "Consigne de départ froid · zone principale", // 2
  "Mode chauffage ou froid", // 3
  "Chauffage ou froid des locaux autorisé", // 4
  "Consigne chauffage · zone principale", // 6
  "Consigne froid · zone principale", // 7
  "Mode silencieux", // 9
  "Consigne de réchauffage ECS", // 10
  "Réchauffage ECS autorisé", // 12
  "Mode boost ECS demandé", // 13
  "État de diagnostic de l’unité", // 21
  "Code défaut de l’unité", // 22
  "Sous-code défaut de l’unité", // 23
  "Circulateur actif", // 30
  "Compresseur actif", // 31
  "Résistance du ballon active", // 32
  "Désinfection du ballon active", // 33
  "Dégivrage ou redémarrage", // 35
  "Démarrage à chaud", // 36
  "Position de la vanne 3 voies", // 37
  "Mode chauffage ou froid actuel", // 38
  "Départ à la sortie du PHE", // 40
  "Départ après BUH", // 41
  "Température de retour", // 42
  "Température du ballon ECS", // 43
  "Température extérieure", // 44
  "Température du liquide frigorigène", // 45
  "Débit", // 49
  "Température ambiante de la zone principale", // 50
  "Puissance électrique absorbée", // 51
  "Fonctionnement ECS", // 52
  "Fonctionnement des locaux", // 53
  "Correction de départ · zone principale", // 54
  "Correction froid · zone principale", // 55
  "Mode Smart Grid", // 56
  "Limite de puissance pour stockage", // 57
  "Limite générale de puissance", // 58
]);

DESCRIPTION_I18N.fr = descriptionValues([
  ["Température cible du ballon ECS ou du stockage thermique."], // 0
  ["Second capteur du ballon, par exemple en bas d’un ballon à deux sondes."], // 1
  ["Température du capteur R5T."], // 2
  ["Mode puissant : charge immédiate jusqu’à la consigne confort ou stockage."], // 3
  ["Préchauffage X10A avant demande/programme ; ce n’est pas la désinfection HomeHub et ne la prouve pas."], // 4
  ["HomeHub 33 signale la désinfection ; une impulsion entre lectures Modbus peut être manquée."], // 5
  ["Bit thermostat extérieur, distinct de la demande intérieure et ne prouvant pas le compresseur."], // 6
  ["Bit extérieur de bas niveau sonore ; le niveau silencieux et son déclencheur ne sont pas établis."], // 7
  ["Bit d’entrée solaire hydraulique ; fonction et polarité non établies."], // 8
  ["Phase interne d’attente ou démarrage, pas de chaleur utile ; un bref ON au départ peut être normal."], // 9
  ["Opération interne ramenant l’huile frigorifique au compresseur."], // 10
  ["Phase d’égalisation frigorifique, pas une pression mesurée ni une position de vanne confirmée."], // 11
  ["Demande extérieure propriétaire sans sens documenté ; à utiliser seulement en corrélation."], // 12
  ["Commande/état 4WV : position non confirmée ; polarité à relier au mode et aux températures."], // 13
  ["Chauffage de carter : commande/état, pas courant ni température ; possible compresseur arrêté."], // 14
  ["Bit propriétaire de sortie ; ne prouve ni mouvement ni polarité, à comparer aux pressions/températures."], // 15
  ["Sous-code intérieur sans table validée par modèle ; zéro n’exclut pas un défaut principal."], // 16
  ["Commande/état de vanne de plancher, pas position ni débit ; polarité non confirmée."], // 17
  ["ON signifie système arrêté, mais protections, pompes ou chauffages peuvent encore fonctionner."], // 18
  ["Entrée thermostat externe de zone 2, pas température ni compresseur ; comparer au contact configuré."], // 19
  ["Demande thermostat principal chaud/froid ; confirmer par mode, pompe, vanne et compresseur."], // 20
  ["L’un des quatre bits bruts de limite ; ne déduire aucun étage avant d’établir le codage observé."], // 21
  ["Bit chauffage PHE : commande ou retour inconnu, et aucune preuve de courant."], // 22
  ["Autorisation du réchauffage ECS sur le registre 12 ; ON = autorisé, OFF = désactivé, sans prouver une charge en cours."], // 23
  ["Demande de montée rapide ECS (booster) sur le registre 13 ; ON = demandé ou actif, OFF = fonctionnement normal."], // 24
  ["Le réchauffage remonte le ballon à sa consigne après passage sous le seuil de démarrage."], // 25
  ["Préréglage programmé : Confort emploie la cible haute et Éco la basse."], // 26
  ["Dans un système hybride, le régulateur demande l’ECS à la chaudière."], // 27
  ["3WV dirige l’eau vers ECS ou locaux ; 1=ECS et 0=locaux, sans prouver l’activité."], // 28
  ["Sortie X10A ON/OFF d’une 2WV optionnelle ; elle ne prouve ni mode, ni tension, ni position mécanique."], // 29
  ["Ouverture de la vanne mélangeuse d’une seconde zone."], // 30
  ["Cible de départ du mode chauffage ou froid sélectionné."], // 31
  ["Température de départ mélangée d’une zone secondaire, après sa vanne mélangeuse."], // 32
  ["Température après BUH, généralement R2T ; elle inclut son apport sans prouver la température aux émetteurs."], // 33
  ["R1T sort du PHE avant BUH ; avec R4T et débit, estime la puissance par mode, emplacement selon l’unité."], // 34
  ["Retour R4T au PHE ; évaluer le ΔT avec débit, compresseur et mode, jamais avec 5 K universels."], // 35
  ["Débit du circuit commun ; le minimum dépend du modèle et du mode, et une valeur basse peut causer 7H."], // 36
  ["Pression hydraulique : beaucoup de manuels exigent >1 bar ; à ≤1,0 bar consulter la notice du modèle exact."], // 37
  ["Commande X10A inversée : 0 = max, 100 = arrêt ([0, 100] → 100–0 %). Ne mesure pas les RPM ni ne prouve rotation, hauteur ou débit ; lisez ON/OFF et débit séparément."], // 38
  ["État pompe ; ne prouve pas la chaleur utile et peut agir sans compresseur : comparer au débit."], // 39
  ["État du circulateur d’un circuit solaire thermique configuré."], // 40
  ["Vitesse indiquée de la pompe nommée par ce profil."], // 41
  ["État X10A du fluxostat : ON indique un mouvement détecté, pas des l/min ni le minimum ; certains modèles ne documentent aucun contact physique."], // 42
  ["Mode hydraulique : arrêt, chauffage, froid, ECS ou combiné ; ne prouve ni compresseur ni transfert."], // 43
  ["Ordre Smart Grid à quatre états lu par HomeHub ou dérivé de deux contacts X10A ; ce n’est pas le mode chaud/froid."], // 44
  ["Mode locaux actif chauffage/froid, sans Auto ; ne prouve pas le compresseur et exige l’activité."], // 45
  ["Sélection HomeHub Auto/chauffage/froid ; configuration, pas état actuel ni preuve d’activité."], // 46
  ["État extérieur arrêt/chauffage/froid ; peut rester choisi compresseur arrêté et ne prouve pas la chaleur."], // 47
  ["Indicateur combiné dégivrage et redémarrage compresseur sur le registre 35 ; OFF = normal, ON = dégivrage ou préparation au redémarrage."], // 48
  ["Indicateur de démarrage à chaud sur le registre 36 ; OFF = régime établi, ON = bref préchauffage de l’échangeur."], // 49
  ["Dégivrage extérieur ; normal par froid humide, mais ce bit seul ne diagnostique pas des cycles excessifs."], // 50
  ["Classe de gravité d’un défaut actif : Normal, Erreur, Avertissement ou Prudence."], // 51
  ["Signification du code de défaut actuellement signalé"], // 52
  ["Fonctionnement de secours après un défaut de pompe à chaleur."], // 53
  ["Relais d’alarme de l’unité ; il s’active pour signaler un défaut à une alarme ou supervision externe câblée."], // 54
  ["Température ambiante cible de la zone principale en chauffage ou froid."], // 55
  ["Demande interne « thermo ON » ; elle n’identifie pas la charge ni le compresseur, et « Space heating Operation » n’est pas une demande."], // 56
  ["Sortie électrique « Space H Operation » ; ni activité normale ni preuve du compresseur ou de chaleur."], // 57
  ["Activité normale chauffage/froid, pas demande ; peut être ON à froid avec compresseur arrêté."], // 58
  ["Température ambiante cible réglée pour la zone pilotée par le propre capteur de l’unité."], // 59
  ["Température ambiante mesurée par le capteur intégré ou câblé de l’unité."], // 60
  ["Protection refoulement : ON/OFF actuel + compteur 0–7 ; seule hausse comparable = activité, pas cause ; seuil/reset/retour 7→0 inconnus."], // 61
  ["Protection courant onduleur : ON/OFF actuel + compteur 0–7 ; seule hausse comparable = activité, pas cause ; seuil/reset/retour 7→0 inconnus."], // 62
  ["Protection haute pression : ON/OFF actuel + compteur 0–7 ; seule hausse comparable = activité, pas cause ; seuil/reset/retour 7→0 inconnus."], // 63
  ["Protection basse pression : ON/OFF actuel + compteur 0–7 ; seule hausse comparable = activité, pas cause ; seuil/reset/retour 7→0 inconnus."], // 64
  ["Protection thermique onduleur : ON/OFF actuel + compteur 0–7 ; seule hausse comparable = activité, pas cause ; seuil/reset/retour 7→0 inconnus."], // 65
  ["Bit interne générique de limitation non affecté aux cinq protections nommées."], // 66
  ["Température d’eau à l’entrée ou à la sortie du PHE, qui transfère la chaleur entre frigorigène et circuit hydraulique."], // 67
  ["Capteur de l’échangeur extérieur ; <0 °C peut être normal et sans humidité ne prouve pas le givre."], // 68
  ["Température extérieure mesurée par l’unité, utilisable pour loi d’eau et décisions de fonctionnement."], // 69
  ["Gaz chaud en sortie compresseur ; dépend de la pression, vitesse, mode et charge. Une valeur ou plage d’une autre famille ne prouve ni défaut ni manque de fluide."], // 70
  ["Température du gaz frigorigène froid à basse pression revenant au compresseur."], // 71
  ["Température du fluide frigorigène sur la ligne liquide entre les échangeurs."], // 72
  ["Température du frigorigène entrant/sortant de l’évaporateur, l’échangeur qui absorbe la chaleur."], // 73
  ["Température de la ligne d’injection de frigorigène, utilisée en interne pour piloter l’injection et protéger le cycle."], // 74
  ["Température d’une zone diphasique, liquide et vapeur, du circuit frigorifique."], // 75
  ["Capteur de dégivrage extérieur ; position et contrôle selon le modèle. Un point ne prouve ni le givre de toute la batterie ni la fin du dégivrage."], // 76
  ["Température de saturation calculée depuis la pression ; ce n’est ni un capteur séparé ni une pression en bar."], // 77
  ["Pression haute/basse : juger une tendance stable au même mode/modèle ; démarrage, retour d’huile et dégivrage la changent. Pas de plage universelle."], // 78
  ["Vitesse compresseur en rps ; dépend du modèle, une hausse demande souvent plus, sans mesurer la chaleur."], // 79
  ["Commande EEV en pas, sans retour mécanique, ni % ni débit. Seule, elle ne prouve ni mouvement, blocage ni manque de fluide."], // 80
  ["Température de l’électronique de commande du moteur du ventilateur extérieur."], // 81
  ["Vitesse du ventilateur extérieur, en étage ou tr/min."], // 82
  ["Cible interne selon modèle/mode ; comparer à la saturation issue de la pression correspondante. L’écart ne diagnostique ni cause ni charge."], // 83
  ["Cible interne de température de refoulement/port du compresseur, utilisée par les protections de l’unité."], // 84
  ["ΔT cible entre départ et retour ; il dépend du modèle et du mode, pas d’une règle universelle de 5 K."], // 85
  ["Fluide frigorigène chargé, par exemple R32 ou R410A."], // 86
  ["Température mesurée à un port du compresseur pour sa surveillance et sa protection internes."], // 87
  ["Mesure de pression du circuit frigorifique de l’unité extérieure."], // 88
  ["Courant de phase par CT ; l’estimation à 230 V n’est pas étalonnée et ignore tension réelle et facteur de puissance."], // 89
  ["Courant absorbé par l’onduleur du compresseur, indicateur approximatif de son effort."], // 90
  ["Température du dissipateur de l’onduleur/électronique de puissance extérieure."], // 91
  ["Étage(s) actif(s) de l’appoint électrique, exprimés comme niveau de puissance."], // 92
  ["Puissance BUH : 0=aucune ; un niveau supérieur peut aider par grand froid, dégivrage, ECS ou secours selon réglages."], // 93
  ["Entrée HomeHub 32 : état ON/OFF de BSH, pas sa puissance ; l’entrée 51 est la consommation de la pompe à chaleur, pas de BSH."], // 94
  ["BSH du ballon peut chauffer sans compresseur ni pompe ; X10A donne ON/OFF, pas la puissance."], // 95
  ["État de la chaîne de protection thermique d’un chauffage électrique, destinée à interrompre son fonctionnement à l’ouverture."], // 96
  ["Antigel des conduites ; il dépend du modèle, exige du courant et ne protège pas pendant une coupure."], // 97
  ["État antigel X10A ; sans données du modèle il n’identifie ni pompe, ni résistance, ni zone protégée."], // 98
  ["Circuit géothermique de saumure et sa pompe ; fluide, pression et limites dépendent du plan et de la notice."], // 99
  ["Source hybride pompe/combinée/chaudière ; c’est une sélection, pas une chaleur mesurée."], // 100
  ["Cible de départ hybride, pas température mesurée ; à lire avec mode et valeurs réelles."], // 101
  ["Autorisation/état bivalent ; ON ne prouve pas que la chaudière brûle."], // 102
  ["Demande chaudière ; ne prouve ni brûleur ni chaleur livrée."], // 103
  ["Cible d’eau chaudière, pas température mesurée ; dépend de la demande et de l’installation."], // 104
  ["Valeur bivalente BE_COP ; sens et échelle X10A non documentés, ce n’est pas le COP actuel."], // 105
  ["Entrée tarif, Smart Grid ou solaire ; l’action dépend du réglage et ON indique seulement le contact."], // 106
  ["Puissance nominale/classe fixe intérieure ou extérieure, en kW ou code ; pas une mesure actuelle."], // 107
  ["Le mode silencieux réduit le bruit extérieur selon le niveau choisi et peut diminuer la capacité de chauffage ou de froid."], // 108
  ["État HomeHub Sans erreur/Défaut/Avertissement ; il n’identifie pas seul la cause."], // 109
  ["Signification du code de défaut actuellement signalé"], // 110
  ["Sous-code complémentaire ; valable avec état/code principal, masqué s’il est indisponible."], // 111
  ["HomeHub donne compresseur ON/OFF, pas vitesse ni puissance ; à lire avec opération et débit."], // 112
  ["Indique si le fonctionnement ECS normal est actif."], // 113
  ["Indique si le fonctionnement normal chauffage ou froid des locaux est actif."], // 114
  ["Sortie PHE avant BUH ; à comparer au retour seulement en circulation pour obtenir le ΔT."], // 115
  ["Départ après BUH ; une hausse peut être électrique, à confirmer par l’état BUH."], // 116
  ["Température de l’eau mesurée dans le ballon ECS."], // 117
  ["Température de ligne liquide ; sa relation dépend du mode et une valeur isolée ne diagnostique pas."], // 118
  ["Température ambiante de la zone principale signalée par la télécommande."], // 119
  ["Puissance électrique via HomeHub ; elle dépend du mode et des charges et ne doit pas être attribuée au seul compresseur."], // 120
  ["Cible départ chauffage HomeHub, en lecture seule : fixe ou climatique ; la baisser n’aide que si la consigne ambiante reste atteinte."], // 121
  ["Cible départ froid HomeHub, en lecture seule : pertinente si froid permis et actif ; peut rester visible sinon."], // 122
  ["Indique si le circuit des locaux est autorisé : c’est l’interrupteur, pas l’activité actuelle."], // 123
  ["Le fonctionnement silencieux réduit le bruit extérieur selon le niveau réglé et peut diminuer la capacité disponible."], // 124
  ["Cible de réchauffage ECS, pas le seuil de départ ; hystérésis et programme comptent aussi."], // 125
  ["Correction −10…+10 K de la cible chauffage ; elle ne prouve aucune chaleur sans fonctionnement des locaux."], // 126
  ["Correction −10…+10 K de la cible froid ; elle ne prouve aucun froid sans fonctionnement des locaux et mode froid actifs."], // 127
  ["Limite de stockage en Marche recommandée ; la plus basse avec la générale prévaut, sans être la consommation."], // 128
  ["Plafond général HomeHub, pas consommation ; le baisser restreint tous les modes Smart Grid."], // 129
]);

MODEL_DESCRIPTION_I18N.fr = modelDescriptionValues([
  ["Affiche les codes d'erreur et d'avertissement signalés par la pompe à chaleur ; les descriptions courtes sont des indications générales Daikin et la disparition d'un code ne prouve pas que la cause soit corrigée."], // health_fault
  ["R5T : un point du ballon stratifié, pas une énergie.", "Indice interne ≥0,8 K/h sans indice pompe/puisage. Sans indice, un puisage reste possible ; 0 K/h n’exclut pas les pertes. Circulation ne prouve pas la cause."], // health_dhw_loss
  ["Des mesures manquantes peuvent laisser certains démarrages non comptés.", "Il n’existe pas de nombre normal fixe de démarrages. Avec suffisamment de données, ce contrôle considère qu’une durée moyenne d’au moins 10 minutes est suffisante pour les cycles de chauffage terminés."], // health_cycling
  ["Dégivrage ", "≥3 associés, >15% du temps de marche du compresseur si états compresseur et dégivrage lisibles. Règle interne, pas Daikin; humidité et température de toute la batterie absentes."], // health_defrost
  ["Courbe 24 h de la pression d’eau du circuit hydraulique fermé (X10A, minimums sur 5 min).", "Repères sur la courbe : >1,0 bar normale, ≤1,0 bar basse, ≤0,5 bar critique (diagnostic dès 60 s continues). La pression de remplissage et de service admissible dépend du manuel exact de l’appareil et de la hauteur du réseau ; la mesure seule ne prouve ni fuite ni panne."], // health_pressure
  ["Débit minimal après 60 s de marche continue de la pompe interne ; séparément : statistiques pondérées par échantillon d’écart thermique de l’eau, débit et commande de pompe après 600 s de mise en chauffe.", "Ni débit nominal ni preuve de charge partielle. Couvre l’échangeur à eau commun. La commande de pompe ne mesure ni vitesse ni hauteur manométrique. Filtre projet de 600 s (lacunes ≤15 s), sans prouver régime établi, comparaison cible ni cause hydraulique."], // health_flow
  ["Temps ON de BUH/BSH ", "pas énergie ni preuve de chaleur inutile."], // health_heater
  ["5 compteurs expérimentaux ", "hausses comparables ; lacunes/reset ignorés. Stabilité n’exclut pas limitation ni ne prouve cause."], // health_retries
  ["RAM 24 h stable, creux résorbés; baisse durable: fuite possible. Redémarrage compatible alimenté: courbe RAM possible. Sinon, journal flash requis: 5 min datées compatibles après synchro. Le pas de 5 min peut cacher un bref arrêt. Ouvert/récents non sauvés peuvent manquer."], // free_heap
  ["Plus grand bloc contigu requis par TLS/OTA ; sa baisse avec RAM totale stable indique une fragmentation."], // max_alloc
  ["Puissance nominale de l’unité extérieure, pas sa production actuelle."], // capacity
  ["Puissance nominale de l’UNITÉ INTÉRIEURE ; ne pas l’attribuer à l’extérieure ou au système complet."], // capacity_iu
  ["Plusieurs familles partagent registres et puissance : les valeurs restent valides, mais le modèle exact exige de comparer l’ID à la plaque."], // candidates
  ["Sans puissance extérieure les candidats peuvent différer ; la meilleure correspondance intérieure est utilisée sans certitude, à vérifier sur la plaque."], // candidates_nocap
  ["Octets d’identification extérieure sans table publique des noms ; en cas d’ambiguïté, les comparer à la plaque."], // oueeprom
]);

FAULT_CODE_I18N.fr = faultCodeValues([
  "Problème de débit d’eau", // 7H
  "Défaut du capteur de température de retour", // 80
  "Défaut du capteur de température de départ", // 81
  "Protection antigel de l’échangeur activée", // 89
  "Hausse anormale de la température de sortie ECS", // 8F
  "Hausse anormale de la température de départ", // 8H
  "Défaut de détection du passage par zéro", // A1
  "Problème de limitation haute pression ou de protection antigel", // A5
  "Chauffage d’appoint surchauffé ou non raccordé", // AA
  "Résistance d’appoint du ballon surchauffée", // AC
  "Désinfection antillégionelle du ballon non terminée", // AH
  "Temps de chauffe ECS dépassé", // AJ
  "Défaut du capteur de débit", // C0
  "Défaut du capteur de température de l’échangeur", // C4
  "Défaut d’un capteur de l’échangeur", // C5
  "Défaut du capteur de température ambiante", // CJ
  "Carte électronique de l’unité extérieure défectueuse", // E1
  "Défaut de détection du courant de fuite", // E2
  "Pressostat haute pression de l’unité extérieure déclenché", // E3
  "Défaut de pression d’aspiration", // E4
  "Surchauffe du moteur du compresseur inverter extérieur", // E5
  "Échec du démarrage du compresseur extérieur", // E6
  "Défaut du moteur du ventilateur extérieur", // E7
  "Surtension d’entrée de l’unité extérieure", // E8
  "Défaut du détendeur électronique", // E9
  "Problème de commutation froid/chauffage de l’unité extérieure", // EA
  "Hausse anormale de la température du ballon", // EC
  "Défaut de température du tuyau de refoulement extérieur", // F3
  "Pression anormalement élevée de l’unité extérieure en refroidissement", // F6
  "Pression extérieure anormalement élevée ; pressostat haute pression déclenché", // FA
  "Défaut du capteur de tension ou de courant extérieur", // H0
  "Défaut d’un capteur de température externe", // H1
  "Défaut du pressostat haute pression extérieur", // H3
  "Défaut de protection contre la surcharge du compresseur", // H5
  "Défaut du capteur de détection de position extérieur", // H6
  "Défaut du système CT d’entrée du compresseur extérieur", // H8
  "Défaut du capteur d’air extérieur de l’unité extérieure", // H9
  "Défaut du capteur de température du ballon", // HC
  "Défaut du capteur de pression d’eau", // HJ
  "Défaut du capteur du tuyau de refoulement extérieur", // J3
  "Défaut du capteur de l’échangeur extérieur", // J6
  "Défaut du capteur haute pression extérieur", // JA
  "Défaut de la carte inverter", // L1
  "Hausse anormale de température du coffret de commande extérieur", // L3
  "Hausse anormale de température du dissipateur inverter extérieur", // L4
  "Surintensité DC détectée dans l’inverter extérieur", // L5
  "Protection thermique de la carte inverter déclenchée", // L8
  "Protection contre le blocage du compresseur déclenchée", // L9
  "Défaut du système de communication extérieur", // LC
  "Déséquilibre ou perte de phase d’alimentation", // P1
  "Tension DC anormale détectée", // P3
  "Défaut du capteur de température du dissipateur extérieur", // P4
  "Réglage de puissance incompatible", // PJ
  "Manque de fluide frigorigène dans l’unité extérieure", // U0
  "Inversion ou perte de phase", // U1
  "Défaut de tension secteur de l’unité extérieure", // U2
  "Séchage de chape du plancher chauffant mal terminé", // U3
  "Problème de communication entre unités intérieure et extérieure", // U4
  "Problème de communication avec l’interface utilisateur", // U5
  "Défaut de transmission entre CPU principale et CPU inverter extérieure", // U7
  "Problème de communication avec adaptateur LAN, thermostat d’ambiance ou USB", // U8
  "Combinaison ou compatibilité incorrecte entre unités", // UA
  "Tuyauterie inversée ou câblage de communication défectueux", // UF
], "Aucun code de défaut n’est transmis.", "Aucune description courte n’est enregistrée pour ce code.");

MB_DELTA_I18N.fr = mbDeltaValues([
  "compresseur arrêté, X10A conserve la valeur du dernier cycle ; le registre HomeHub continue d’être lu, mais sans horodatage de mesure", // outdoor_air
  "les deux valeurs proviennent de régulateurs d’ambiance différents", // room_temp
]);
