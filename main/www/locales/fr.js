// translation-source: 271d4acd12297e3776de11cec2547c02e536741aeb8de7c7dc2e0a589feebe57
I18N.fr = localeValues([
  /* sys.nodata */ "Aucune donnée",
  /* sys.unreachable */ "Injoignable",
  /* sys.x10a_down */ "X10A hors ligne",
  /* sys.mb_carrying */ "Mode de fonctionnement inconnu — relevés Modbus",
  /* sys.mb_only */ "X10A hors ligne — relevés Modbus",
  /* sys.mb_source */ "X10A hors ligne · Modbus",
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
  /* sys.online */ "En ligne",
  /* sys.fault */ "Défaut",
  /* sys.warning */ "Avertissement",
  /* sys.fault_line */ (c) => "Défaut · " + c + " — vérifiez le code de défaut Daikin.",
  /* sys.warning_line */ (c) => "Avertissement · " + c + " — vérifiez la pompe à chaleur.",
  /* sys.polled */ (s) => `Interrogé il y a ${s} s`,
  /* recovery.title */ "Mode de récupération",
  /* recovery.meta_heap */ "L’appareil a manqué de mémoire à plusieurs reprises et a redémarré. Il fonctionne maintenant avec la connexion à la pompe à chaleur et MQTT désactivés, afin que l’interface web reste accessible. La configuration est très probablement correcte — installez une version plus récente du micrologiciel dans Paramètres. Une mise hors tension puis sous tension relance la pile complète.",
  /* recovery.meta */ "L’appareil a redémarré à plusieurs reprises et est passé en mode de récupération. La communication avec la pompe à chaleur et MQTT est suspendue. Vérifiez la configuration — en particulier les broches RX/TX de la carte Protocole dans Paramètres — puis redémarrez l’appareil.",
  /* rollback.title */ "Échec de la modification WiFi — ancienne configuration restaurée",
  /* rollback.meta */ (back) => `L’appareil n’a pas pu se connecter avec les nouveaux paramètres WiFi. Il a restauré le réseau précédent${back} et redémarré. Vérifiez le nom du réseau et le mot de passe dans Paramètres → Connexions, puis réessayez.`,
  /* crash.title_fault */ "L’appareil a redémarré après un plantage",
  /* crash.title_orphan */ "Un rapport de plantage d’un redémarrage antérieur est en attente",
  /* crash.reset */ "Réinitialisation",
  /* crash.task */ "tâche",
  /* crash.fw */ "fw",
  /* crash.elf */ "elf",
  /* crash.corrupted */ "corrompu",
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
  /* bug.what_ph */ "Depuis ce matin, la température du ballon indique 12800 °C dans Home Assistant.",
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
  /* nav.settings_alert */ (n) => `Paramètres — ${n} ${n === 1 ? "connexion indisponible" : "connexions indisponibles"}`,
  /* src.modbus_tag */ "modbus",
  /* src.agree */ "Les deux sources concordent",
  /* src.delta */ (d, u) => `Différence ${d}${u ? " " + u : ""}`,
  /* src.disagree */ "Les deux sources ne concordent pas sur cet état",
  /* conn.homehub */ "HomeHub",
  /* conn.searching */ "Recherche…",
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
  /* service.title */ "Observation frigorifique de maintenance",
  /* service.state.waiting */ "EN ATTENTE",
  /* service.state.observing */ "OBSERVATION",
  /* service.state.limited */ "LIMITÉE",
  /* service.state.interrupted */ "INTERROMPUE",
  /* service.row.window */ "Fenêtre actuelle",
  /* service.row.reason */ "Raison",
  /* service.reason.unsupported_profile */ "Le profil ne fournit pas les signaux requis.",
  /* service.reason.compressor_not_running */ "Compresseur arrêté.",
  /* service.reason.unsupported_or_unknown_mode */ "Pas en chauffage ou mode inconnu.",
  /* service.reason.dhw_path */ "ECS active.",
  /* service.reason.defrost */ "Le dégivrage est actif.",
  /* service.reason.unit_fault */ "Défaut d’unité actif.",
  /* service.reason.special_controller_phase */ "Démarrage, redémarrage, retour d’huile ou égalisation de pression actif.",
  /* service.reason.missing_fresh_signal */ "Signal récent requis manquant.",
  /* service.reason.poll_gap */ "Interruption ou pause volontaire X10A.",
  /* service.window */ (d, n) => `${d} · ${n} ${n === 1 ? "échantillon récent" : "échantillons récents"}`,
  /* service.help.observing */ "Les valeurs récentes du même relevé X10A restent continues dans ces conditions.",
  /* service.help.limited */ "Fenêtre continue ; contexte facultatif de température, pression, extérieur ou phase manquant.",
  /* service.help.interrupted */ "Fenêtre terminée ; le prochain relevé admissible repart de zéro.",
  /* service.common */ "Observation seule : aucun essai de maintenance/pleine charge ; aucune preuve de stabilisation ou de charge ; aucune plage jugée. Les impulsions EEV sont des commandes, pas un retour de vanne.",
  /* check.fault */ "Défaut de l’unité",
  /* check.dhw_loss */ "Perte de chaleur du ballon ECS",
  /* check.cycling */ "Démarrages du compresseur",
  /* check.defrost */ "Cycles de dégivrage",
  /* check.pressure */ "Pression d’eau, minimum",
  /* check.flow */ "Débit, minimum",
  /* check.heater */ "Chauffage d’appoint",
  /* check.retries */ "Nouvelles tentatives de protection",
  /* check.status.ok */ "OK",
  /* check.status.info */ "NOTE",
  /* check.status.warn */ "AVERTISSEMENT",
  /* check.status.collecting */ "VÉRIFICATION",
  /* check.status.observation */ "MESURE UNIQUEMENT",
  /* check.status.experimental */ "EXPÉRIMENTAL",
  /* check.status.unavailable */ "INDISPONIBLE",
  /* check.summary */ (s, n, a) => a > 0 ? `${s} · ${n}/${a} évalués` : s,
  /* check.detail.value_label */ "Valeur :",
  /* check.detail.assessment_label */ "Évaluation :",
  /* check.detail.ok */ "Évaluation terminée ; aucun constat dans les données observées de l’installation.",
  /* check.detail.info */ "Bon à savoir, mais cela ne prouve pas un défaut. Ce qui est considéré comme notable ici figure sous « Normal » ci-dessous.",
  /* check.detail.warn */ "Un constat de l’appareil ou une limite documentée requiert votre attention.",
  /* check.detail.fault.error */ "L’unité signale actuellement une erreur. Le code exact figure sur la carte « Fonctionnement ».",
  /* check.detail.fault.warning */ "L’unité signale actuellement un avertissement ou une mise en garde, et non une erreur. Le code exact figure sur la carte « Fonctionnement ».",
  /* check.detail.fault.past */ "Rien n’est signalé actuellement. Un message est apparu au cours des dernières 24 heures puis a disparu de lui-même ; c’est pourquoi cette ligne n’indique pas OK. Aucune action n’est requise pour un message disparu ; s’il revient, notez quand il apparaît.",
  /* check.detail.fault.past_unknown */ "Un message est apparu au cours des dernières 24 heures. Impossible de savoir s’il est actif actuellement — la ligne de défaut ne répond pas, vérifiez donc la liaison X10A.",
  /* check.detail.collecting */ (n, r) => `${n} sur ${r} capturés ; aucune évaluation n’est encore possible.`,
  /* check.detail.cycling_split */ " Seul le chauffage des locaux confirmé est évalué ici. Les cycles d’eau chaude obéissent à d’autres contraintes ; le rafraîchissement identifié avec certitude est exclu. Le comptage se fait par cycle complet : la vanne 3 voies et, sur le circuit des locaux, le mode de fonctionnement de l’U/I doivent rester lisibles et inchangés pendant tout le cycle. Tout le reste demeure non classé et n’est pas évalué.",
  /* check.detail.cycling_pooled */ " Tous les cycles sont évalués ensemble, car les preuves de classification étaient insuffisantes : une entrée était trop rare, moins de 12 cycles ont été classés ou plus de 10 % des cycles terminés n’ont pas été classés. L’eau chaude ou le rafraîchissement peuvent donc masquer de courts cycles de chauffage. Les chiffres de classe affichés à côté sont des observations et n’ont pas déterminé le verdict.",
  /* check.detail.outdoor_cycling */ " Les valeurs extérieures X10A ne comprennent que des mesures récentes issues de cycles de chauffage des locaux terminés et classés de manière cohérente. Elles fournissent du contexte et ne modifient ni le seuil de cyclage ni le verdict.",
  /* check.detail.outdoor_defrost */ " Les valeurs extérieures X10A ne comprennent que des mesures récentes lorsque les états du dégivrage et du compresseur étaient tous deux lisibles et que le compresseur fonctionnait. Elles fournissent du contexte et ne modifient ni le seuil de dégivrage ni le verdict.",
  /* check.detail.dhw_candidate */ (n, r, c, w) => `${n} sur ${r} terminés dans des fenêtres propres d’une heure ; fenêtre propre actuelle : ${c} sur ${w}.`,
  /* check.detail.dhw_settling */ (n, r, s) => `${n} sur ${r} terminés dans des fenêtres propres d’une heure ; une charge du ballon ou le BSH a été détecté, il reste ${s} de stabilisation.`,
  /* check.detail.dhw_waiting */ (n, r) => `${n} sur ${r} terminés dans des fenêtres propres d’une heure ; aucune fenêtre propre complète d’une heure pour le moment.`,
  /* check.detail.dhw_aborted */ (n, reasons, best) => ` ${n} ${n === 1 ? "fenêtre candidate rejetée" : "fenêtres candidates rejetées"} (${reasons}) ; la plus longue a atteint ${best} sur 60 min.`,
  /* check.detail.dhw_blocked */ (n, reasons, best) => `Non évaluable avec cette méthode : sur 24 heures complètes, aucune fenêtre propre d’une heure ne s’est terminée et ${n} ${n === 1 ? "fenêtre candidate a été rejetée" : "fenêtres candidates ont été rejetées"} (${reasons}) ; la plus longue a atteint ${best} sur 60 min. La charge du ballon exige 105 minutes sans interruption (45 min de stabilisation plus une fenêtre de 60 minutes) ; les puisages, l’activité de la pompe, des données illisibles ou une perte de chaleur continue assez rapide pour ressembler à un puisage peuvent aussi empêcher une heure propre. Les totaux enregistrés n’indiquent pas quelle cause a dominé, une perte de chaleur continue et rapide ne peut donc pas être exclue.`,
  /* check.detail.dhw_blocked_link */ (n, best) => `Non évaluable : sur 24 heures complètes, aucune fenêtre propre d’une heure ne s’est terminée et ${n === 1 ? "l’unique fenêtre candidate a été rejetée" : `les ${n} fenêtres candidates ont été rejetées`}, car la liaison X10A a cessé de répondre en cours de fenêtre ; la plus longue a atteint ${best} sur 60 min. Le problème vient de la liaison, pas de l’installation — vérifiez le câblage X10A et les broches RX/TX.`,
  /* check.detail.dhw_reason.charge */ "charge du ballon",
  /* check.detail.dhw_reason.pump */ "pompe interne",
  /* check.detail.dhw_reason.draw */ "baisse semblable à un puisage",
  /* check.detail.dhw_reason.reading */ "R5T non plausible",
  /* check.detail.dhw_reason.blind */ "X10A ne répond pas",
  /* check.detail.collecting_unknown */ "Pas encore assez de preuves exploitables pour une évaluation.",
  /* check.detail.observation */ "Valeur mesurée uniquement ; il n’existe pas de limite universelle OK/AVERTISSEMENT.",
  /* check.detail.experimental */ "Observation expérimentale ; un compteur stable ne prouve pas qu’aucune limitation ne s’est produite.",
  /* check.detail.unavailable */ "Le profil actif ne fournit aucune donnée évaluable pour cette vérification.",
  /* check.starts */ (n) => `${n} ${n === 1 ? "démarrage" : "démarrages"}`,
  /* check.cycles */ (n) => `${n} ${n === 1 ? "cycle" : "cycles"}`,
  /* check.paired_cycles */ (n) => `${n} ${n === 1 ? "apparié" : "appariés"}`,
  /* check.mean */ (d) => `${d}/démarrage`,
  /* check.cycling_space */ (n, d) => d ? `locaux ${n} × ${d}` : `locaux ${n}`,
  /* check.cycling_dhw */ (n, d) => d ? `eau chaude ${n} × ${d}` : `eau chaude ${n}`,
  /* check.cycling_cooling */ (n) => `rafraîchissement : ${n} ${n === 1 ? "exclu" : "exclus"}`,
  /* check.cycling_censored */ (n) => `${n} ${n === 1 ? "non classé" : "non classés"}`,
  /* check.outdoor_one */ (source, mean) => `${source} ${mean} °C`,
  /* check.outdoor_range */ (source, min, mean) => `${source} min. ${min} °C · moyenne ${mean} °C`,
  /* check.min */ (m) => `${m} min`,
  /* check.tank */ (m) => `ballon ${m} min`,
  /* check.tank_runtime */ (d) => `ballon ${d}`,
  /* check.loss_windows */ (n) => `${n} ${n === 1 ? "fenêtre" : "fenêtres"}`,
  /* check.loss_pump_off */ "également lorsque la pompe de circulation était arrêtée",
  /* check.loss_with_pump */ "pendant le fonctionnement de la pompe de circulation",
  /* check.loss_unattributed */ "attribution de la pompe incomplète",
  /* check.fault_err */ "Défaut actif",
  /* check.fault_warn */ "Avertissement actif",
  /* check.fault_past */ "Survenu au cours des dernières 24 h · inactif actuellement",
  /* check.fault_none */ "Aucun actif",
  /* check.fault_unknown */ "État actuel inconnu",
  /* check.fault_past_unknown */ "Survenu au cours des dernières 24 h · état actuel inconnu",
  /* check.retry_seen */ "Augmentation du compteur observée",
  /* check.retry_none */ "Aucune augmentation observée",
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
  /* hist.loading */ "Chargement de la tendance…",
  /* hist.none */ "Aucun relevé enregistré pour le moment.",
  /* hist.err */ "Tendance indisponible.",
  /* hist.gaps */ (n) => `${n} ${n === 1 ? "lacune" : "lacunes"} — non mesuré`,
  /* hist.nm */ "non mesuré",
  /* hist.rel */ (h) => `il y a ${h} h`,
  /* hist.held */ "unité extérieure au repos",
  /* hist.heldnote */ (h) => `${h} h au repos — non mesuré`,
  /* hist.forecast */ "Open-Meteo · prévisions",
  /* hist.in_hours */ (h) => `dans ${h} h`,
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
  /* toast.saved */ "Enregistré",
  /* toast.no_changes */ "Aucune modification",
  /* toast.reboot */ "Redémarrage — reconnexion…",
  /* toast.rebooted */ "Redémarré — reconnectez-vous à l’appareil",
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
  /* ota.changes_title */ "Nouveautés de cette version",
  /* ota.no_changes */ "Aucun journal des modifications n’a été fourni pour cette version.",
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
  /* wifi.err_ssid */ "Le SSID ne doit pas dépasser 32 caractères",
  /* wifi.err_pass */ "Le mot de passe doit être vide (réseau ouvert) ou contenir entre 8 et 63 caractères",
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
  /* dyn.card */ "Diagnostic de la courbe de chauffe",
  /* dyn.state */ "État",
  /* dyn.state_recording */ "Enregistrement",
  /* dyn.state_recording_nowx */ "Enregistrement · sans prévisions",
  /* dyn.state_waiting */ "En attente du chauffage des locaux",
  /* dyn.state_cooling */ "Rafraîchissement · non échantillonné",
  /* dyn.state_room */ "Source de pièce inutilisable",
  /* dyn.state_x10a */ "X10A hors ligne",
  /* dyn.state_homehub */ "HomeHub hors ligne",
  /* dyn.state_gate */ "État de l’installation inconnu",
  /* dyn.state_mode */ "Mode chauffage/rafraîchissement inconnu",
  /* dyn.state_clock */ "Horloge non réglée",
  /* dyn.state_blocked */ "Aucun enregistrement",
  /* dyn.state_setup_room */ "Configurez une source de pièce",
  /* dyn.state_setup_homehub */ "HomeHub non configuré",
  /* dyn.state_homehub_disabled */ "Diagnostic arrêté — HomeHub désactivé",
  /* dyn.state_no_broker */ "Aucun enregistrement — aucun broker MQTT",
  /* dyn.state_safe_mode */ "Aucun enregistrement — mode sécurisé",
  /* dyn.state_inactive */ "Aucun enregistrement — échantillonneur arrêté",
  /* dyn.room_off */ "Thermostat d’ambiance arrêté",
  /* dyn.room_not_heating */ "Thermostat d’ambiance pas en mode chauffage",
  /* dyn.room_stale */ "Relevé de pièce trop ancien",
  /* dyn.room_no_value */ "En attente d’un relevé de pièce",
  /* dyn.room_invalid_payload */ "Message MQTT non valide",
  /* dyn.room_invalid_temperature */ "Température ambiante hors de la plage autorisée",
  /* dyn.room_invalid_setpoint */ "Température cible hors de la plage autorisée",
  /* dyn.room_no_setpoint */ "Température cible manquante",
  /* dyn.room_no_time */ "Heure de mesure manquante",
  /* dyn.room_retained_no_time */ "Valeur conservée sans heure de mesure",
  /* dyn.room_future_time */ "L’heure de mesure est dans le futur",
  /* dyn.room_backward_time */ "L’heure de mesure a reculé",
  /* dyn.room_invalid_time */ "Heure de mesure non valide",
  /* dyn.room_no_enabled */ "État marche/arrêt du thermostat manquant",
  /* dyn.room_no_hvac_mode */ "Mode de fonctionnement du thermostat manquant",
  /* dyn.room_source */ "Source de température ambiante",
  /* dyn.weather */ "Prévisions comparatives facultatives",
  /* dyn.strategy */ "Signal de diagnostic",
  /* dyn.not_configured */ "Non configuré",
  /* dyn.outdoor */ "Air extérieur mesuré",
  /* dyn.outdoor_detail_status */ "État",
  /* dyn.outdoor_detail_now */ "Relevé actuel",
  /* dyn.outdoor_detail_sample */ "Lors du dernier événement enregistré",
  /* dyn.outdoor_status_live */ (source) => `${source} dispose d’un relevé actuel ; il est joint à chaque événement enregistré comme contexte.`,
  /* dyn.outdoor_status_unavailable */ (source) => `${source} est configuré, mais ne dispose d’aucun relevé actuel. Les événements continuent sans cet axe.`,
  /* dyn.outdoor_status_absent */ (source) => `${source} n’est pas configuré. Les événements continuent sans cet axe.`,
  /* dyn.outdoor_status_idle */ (source) => `${source} est configuré, mais rien n’est enregistré actuellement. La ligne d’état ci-dessus en indique la raison.`,
  /* dyn.outdoor_sample_none */ "Enregistré sans valeur extérieure",
  /* dyn.outdoor_help_axis */ "La température extérieure permet d’interpréter un écart ambiant enregistré. Sans elle, +0,5 K à −5 °C et +0,5 K à +12 °C semblent identiques, alors que l’un indique une courbe trop pentue et l’autre une courbe réglée trop haut. Elle est facultative : l’enregistrement continue sans elle et sa valeur ne sert jamais à décider si un événement doit être enregistré.",
  /* dyn.outdoor_help_placement */ "Cette valeur correspond à ce que mesure le capteur là où il est installé. Le micrologiciel ne peut pas savoir où il se trouve — près de l’unité intérieure, il mesure l’air ambiant ; à un emplacement extérieur ombragé, il mesure le véritable air extérieur, et seul ce dernier rend la comparaison pertinente.",
  /* dyn.outdoor_help_setup */ "Un M5Stack ENV III branché sur le port Grove de la carte peut fournir cette valeur. Installé dehors et à l’ombre, il mesure continuellement l’air extérieur, contrairement au capteur de la pompe à chaleur, qui cesse d’être actualisé lorsque l’unité extérieure est au repos. Il se configure dans ESP32 → Matériel, avec la carte sur laquelle il est branché.",
  /* dyn.plant_outdoor */ "Air extérieur de l’installation",
  /* dyn.plant_outdoor_help */ "Il s’agit de l’entrée HomeHub 44, la propre notion d’air extérieur de la pompe à chaleur. Elle est capturée pendant le même cycle Modbus actuel que les conditions des fenêtres de chauffage, et sa source est enregistrée avec l’événement. Elle reste distincte d’ENV III et ne change jamais la décision d’enregistrer un événement.",
  /* dyn.shadow_strategy */ "Écart ambiant brut · 30 min",
  /* dyn.card_help */ "Toutes les 30 minutes pendant un chauffage des locaux clairement identifié, le micrologiciel enregistre l’écart entre la température de la pièce de référence et sa cible, ainsi que la température extérieure à cet instant lorsqu’un capteur la fournit. Avec la durée de fonctionnement, les limites minimales de température de départ d’eau et l’activité du thermostat, la tendance à long terme peut montrer si la courbe de chauffe tend à être trop haute ou trop basse. Un écart ambiant de 1 K n’implique pas automatiquement une modification de 1 K du départ d’eau. Cette fonction lit uniquement les données et n’écrit rien dans la pompe à chaleur.",
  /* dyn.state_help_recording */ "Le chauffage des locaux confirmé fonctionne et l’entrée de pièce est valide ; les échantillons bruts d’erreur ambiante sont donc enregistrés. Interprétez une tendance saisonnière avec la durée de fonctionnement et les preuves d’écrêtement ; un seul échantillon n’est pas un verdict.",
  /* dyn.state_help_waiting */ "L’installation n’est pas actuellement en fonctionnement normal des locaux, aucun échantillon n’est donc enregistré. Pendant l’été, il s’agit de l’état normal attendu et non d’un défaut.",
  /* dyn.state_help_cooling */ "HomeHub signale un fonctionnement normal des locaux, mais le mode actuel est le rafraîchissement. Les fenêtres de rafraîchissement sont volontairement exclues du jeu de données de la courbe de chauffe.",
  /* dyn.state_help_blocked */ "Une entrée requise est manquante, rien n’est donc enregistré. L’enregistrement reprend dès son retour ; les preuves périmées ou ambiguës ne sont jamais échantillonnées.",
  /* dyn.state_help_room */ "Le relevé de pièce parvient à l’appareil, mais ne peut pas actuellement fournir un écart valide par rapport à la cible. Aucun échantillon n’est formé tant que la source n’est pas de nouveau exploitable.",
  /* dyn.state_help_setup */ "Le diagnostic démarre lorsqu’une source de pièce MQTT horodatée avec une cible est enregistrée. Les prévisions constituent une preuve comparative facultative ; aucune divulgation de l’emplacement n’est nécessaire.",
  /* dyn.state_help_inactive */ "Les sources sont configurées, mais rien ne les évalue : l’échantillonneur fonctionne avec la connexion MQTT, et cette carte a démarré en mode sécurisé après plusieurs démarrages avec plantage, où tous les consommateurs facultatifs restent inactifs. Rien n’est perdu — l’enregistrement reprend automatiquement lorsque la carte redémarre normalement.",
  /* dyn.state_help_no_broker */ "Une source de pièce est enregistrée, mais le diagnostic la lit via MQTT et aucun broker n’est configuré. Configurez le broker dans la carte Connexions ; la source enregistrée est conservée et l’enregistrement démarre automatiquement.",
  /* dyn.state_help_setup_homehub */ "Le diagnostic a besoin du HomeHub pour savoir quand l’installation chauffe réellement ; sans lui, il ne peut pas distinguer une fenêtre de chauffage de l’eau chaude ou d’un arrêt. Configurez l’adresse du HomeHub dans la carte Protocole.",
  /* dyn.state_help_homehub_disabled */ "Ce diagnostic dépend de deux signaux de l’installation HomeHub. Lorsque l’adresse HomeHub est explicitement vide, ni Modbus ni ce diagnostic dépendant ne fonctionnent.",
  /* dyn.strategy_help */ "L’échantillon est la température cible de la pièce moins sa température réelle : une valeur positive signifie que la pièce est sous la cible, une valeur négative qu’elle est au-dessus. Il n’y a ni zone morte, ni arrondi, ni limitation, ni limite de vitesse. Il s’agit d’un indicateur non étalonné, et non d’un décalage demandé de la température de départ d’eau. La pièce de référence doit représenter la zone chauffée. Son propre thermostat ou des vannes fermées forment une boucle de régulation interne : ils peuvent supprimer la demande de chaleur et masquer une courbe trop haute. Interprétez la tendance ambiante avec la fréquence à laquelle la température de départ d’eau est maintenue à son minimum (part d’écrêtement D2) et la fréquence à laquelle la zone demande effectivement de la chaleur.",
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
  /* ref.title */ "Source de température ambiante",
  /* ref.name */ "Nom",
  /* ref.temperature_source */ "Source de température",
  /* ref.target */ "Température cible",
  /* ref.timestamp_source */ "Source d’horodatage · facultative",
  /* ref.max_age */ "Ancienneté maximale · secondes",
  /* ref.temperature_source_help */ "Sujet MQTT exact et chemin JSON facultatif après $. Les chemins absents ou incorrects sont signalés à la réception d’un message.",
  /* ref.target_help */ "Une valeur fixe en °C, ou un sujet MQTT exact avec un chemin JSON facultatif après $.",
  /* ref.timestamp_source_help */ "Heure source RFC3339/Unix facultative sous la forme sujet$chemin. Si ce champ est vide, l’heure d’arrivée MQTT en direct est utilisée ; les valeurs conservées sont alors rejetées par sécurité.",
  /* ref.max_age_help */ "Ancienneté maximale autorisée du relevé source, de 10 à 3600 secondes.",
  /* ref.error */ "Dernière erreur",
  /* ref.broker_off */ "Broker MQTT désactivé",
  /* ref.retained */ "mis en cache par le broker",
  /* ref.time_untrusted */ "Valeur conservée sans heure de mesure fiable",
  /* ref.clock_unsynced */ "Horloge de l’appareil non synchronisée",
  /* ref.now */ "maintenant",
  /* ref.ago */ (s) => `il y a ${s} s`,
  /* ref.age_unknown */ "inconnue",
  /* ref.saved */ "Source de température ambiante enregistrée",
  /* ref.detail.status_label */ "État :",
  /* ref.detail.diagnosis_label */ "Diagnostic de la courbe de chauffe :",
  /* ref.status.measurement_valid */ "Mesure valide",
  /* ref.status.not_configured */ "Non configuré",
  /* ref.status.usable */ "Exploitable",
  /* ref.status.unusable */ "Inexploitable",
  /* ref.status.error */ "Erreur",
  /* ref.status.stale */ "Périmé",
  /* ref.status.waiting */ "En attente",
  /* ref.status.unavailable */ "Indisponible",
  /* ref.detail.setup */ "Ajoutez une source MQTT avec le crayon",
  /* ref.detail.stale */ "Le relevé est plus ancien que la limite autorisée",
  /* ref.detail.waiting */ "Aucun relevé MQTT reçu pour le moment",
  /* ref.detail.error */ (e) => `Message MQTT rejeté : ${e}`,
  /* ref.detail.temperature_label */ "Température ambiante :",
  /* ref.detail.temperature */ (v) => `${v} °C`,
  /* ref.detail.setpoint_label */ "Température cible :",
  /* ref.detail.setpoint */ (v) => `${v} °C`,
  /* ref.detail.last_measurement_label */ "Dernier relevé :",
  /* ref.detail.last_measurement */ (v) => v,
  /* ref.detail.last_measurement_stale */ (v, max) => `${v} · autorisé : au maximum ${max} s`,
  /* ref.detail.purpose */ "Le diagnostic compare la température ambiante à la température cible afin de révéler au fil du temps si la courbe de chauffe est trop haute ou trop basse. La pompe à chaleur n’est pas pilotée.",
  /* ref.delete */ "Supprimer",
  /* ref.deleting */ "Suppression…",
  /* ref.deleted */ "Source de température ambiante et relevé capturé supprimés",
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
  /* wx.title */ "Prévisions météorologiques Open-Meteo",
  /* wx.latitude */ "Latitude",
  /* wx.longitude */ "Longitude",
  /* wx.waiting */ "En attente des prévisions",
  /* wx.fetching */ "Récupération des prévisions Open-Meteo…",
  /* wx.unavailable */ "Indisponible",
  /* wx.error */ "Erreur de prévisions Open-Meteo",
  /* wx.detail.status */ "État :",
  /* wx.status.fresh */ "Actuelles",
  /* wx.status.inactive */ "Arrêtées",
  /* wx.status.fetching */ "Mise à jour",
  /* wx.status.stale */ "Périmées",
  /* wx.status.unavailable */ "Indisponibles",
  /* wx.status.waiting */ "En attente",
  /* wx.detail.fresh */ "Les prévisions ont été récupérées avec succès.",
  /* wx.detail.fetching */ "L’ESP32 récupère de nouvelles données de prévisions.",
  /* wx.detail.stale */ "La dernière récupération réussie est trop ancienne ; les valeurs sont affichées uniquement pour le diagnostic.",
  /* wx.detail.unavailable */ "La dernière récupération a échoué ; une valeur antérieure, si elle existe, est affichée uniquement pour le diagnostic.",
  /* wx.detail.waiting */ "Aucune prévision n’a encore été reçue.",
  /* wx.detail.temperature_label */ "Température :",
  /* wx.detail.temperature */ (v) => `${v} °C est la température moyenne prévue de l’air extérieur pour les deux prochaines heures complètes.`,
  /* wx.detail.solar_label */ "Irradiation solaire :",
  /* wx.detail.solar */ (v) => `${v} Wh/m² est l’irradiation horizontale globale prévue sur la même période de deux heures.`,
  /* wx.detail.source_label */ "Source :",
  /* wx.detail.source */ "Open-Meteo · DWD ICON Seamless. Observation uniquement ; les prévisions ne modifient pas le pilotage de la pompe à chaleur.",
  /* wx.err_both */ "Saisissez la latitude et la longitude, ou laissez les deux champs vides pour désactiver",
  /* wx.err_latitude */ "La latitude doit être un nombre décimal compris entre -90 et 90",
  /* wx.err_longitude */ "La longitude doit être un nombre décimal compris entre -180 et 180",
  /* wx.saving */ "Enregistrement de la source météorologique…",
  /* wx.hint.configured */ "L’ESP32 demande de nouvelles prévisions toutes les 45 minutes. Chaque requête envoie les coordonnées à Open-Meteo et révèle l’adresse IP publique de la connexion. Laissez les deux champs de coordonnées vides pour supprimer la source.",
  /* wx.hint.setup */ "Saisissez la latitude et la longitude. Une paire de coordonnées copiée depuis Google Maps peut être collée dans l’un ou l’autre champ et sera séparée automatiquement. Après l’enregistrement, l’ESP32 demande de nouvelles prévisions toutes les 45 minutes. Chaque requête envoie les coordonnées à Open-Meteo et révèle l’adresse IP publique de la connexion. Les prévisions servent uniquement à l’observation et ne modifient pas le pilotage de la pompe à chaleur.",
  /* wx.attribution */ "Données météorologiques par Open-Meteo.com · DWD ICON Seamless",
  /* ref.err_temperature_source */ "Saisissez un sujet MQTT exact, suivi facultativement de $chemin-json",
  /* ref.err_target */ "Saisissez une valeur fixe de 5 à 35 °C ou un sujet MQTT exact, suivi facultativement de $chemin-json",
  /* ref.err_timestamp_source */ "Saisissez un sujet MQTT exact, suivi facultativement de $chemin-json",
  /* ref.err_max_age */ "L’ancienneté maximale doit être un nombre entier compris entre 10 et 3600 secondes",
  /* ref.save_help */ "Enregistrer mémorise l’association. Elle s’abonne lorsque le diagnostic de l’installation est activé ; sinon, elle reste inactive. Une valeur MQTT lisible et récente demeure nécessaire.",
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
  /* board.led_rgb_off */ "Éteinte — aucun mode Wi-Fi actif.",
  /* board.led_rgb_setup */ "Bleue, clignotement lent — portail de configuration actif.",
  /* board.led_rgb_connecting */ "Jaune, clignotement rapide — connexion au Wi-Fi.",
  /* board.led_rgb_healthy */ "Verte fixe — toutes les connexions configurées sont prêtes.",
  /* board.led_rgb_bus_down */ "Rouge, double flash — X10A déconnecté.",
  /* board.led_rgb_mqtt_down */ "Orange, clignotante — X10A connecté, MQTT déconnecté.",
  /* board.led_rgb_wipe_armed */ "Rouge, clignotement très rapide — effacement armé ; relâchez pour annuler.",
  /* board.led_rgb_wiping */ "Blanche fixe — effacement des paramètres ; ne coupez pas l’alimentation.",
  /* board.led_gpio_off */ "Éteinte — aucun mode Wi-Fi actif.",
  /* board.led_gpio_setup */ "Clignotement lent — portail de configuration actif.",
  /* board.led_gpio_connecting */ "Clignotement rapide — connexion au Wi-Fi.",
  /* board.led_gpio_healthy */ "Fixe — toutes les connexions configurées sont prêtes.",
  /* board.led_gpio_bus_down */ "Double flash — X10A déconnecté.",
  /* board.led_gpio_mqtt_down */ "Clignotement à vitesse moyenne — X10A connecté, MQTT déconnecté.",
  /* board.led_gpio_wipe_armed */ "Clignotement très rapide — effacement armé ; relâchez pour annuler.",
  /* board.led_gpio_wiping */ "Fixe après un clignotement très rapide — effacement des paramètres ; ne coupez pas l’alimentation.",
  /* board.ledinv */ "Actif au niveau bas (la LED s’allume lorsque la broche est commandée LOW)",
  /* board.btninv */ "Actif au niveau bas (le bouton relie la broche à GND)",
  /* board.hint */ "Maintenez le bouton de réinitialisation pendant 5 secondes pour effacer tous les paramètres et ouvrir le portail de configuration. Sélectionnez « Aucun » lorsqu’aucun bouton n’est connecté.",
  /* card.hardware */ "Matériel",
  /* card.hw_off */ "Aucun",
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
  /* card.diagnostics_help */ "Active la vérification de l’installation sur 24 heures, le diagnostic de la courbe de chauffe et des sources supplémentaires telles que la température ambiante, les prévisions météorologiques et la puissance de la pompe de circulation.",
  /* diagnostics.off */ "Désactivé",
  /* diagnostics.on */ "Activé",
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
  /* hist.cop_none */ "Aucune courbe de COP lorsque la puissance électrique provient des pinces CT. Les charges prises en compte dépendent du câblage ; la puissance thermique enregistrée s’arrête avant BUH et n’inclut pas la chaleur directe de BSH, donc une même frontière de bilan n’est pas garantie.",
]);
INSPECT_I18N.fr = inspectValues(
  ["Aucun relevé actuel :", "le compresseur est arrêté et l’unité extérieure n’actualise ses propres capteurs qu’en fonctionnement. La valeur du dernier cycle est masquée pour ne pas la présenter comme actuelle."],
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
      ? "En veille : compresseur arrêté. X10A n’actualise plus les capteurs extérieurs ; l’air extérieur vient du HomeHub, le refoulement reste « — » et l’âge réel de cette mesure Modbus est inconnu."
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
      : `${fmt1(d.dt)} K${d.dtSet != null ? ` pour une cible chauffage de ${fmt1(d.dtSet)} K` : ""}. Positif signifie que le PHE apporte de la chaleur à l’eau.`], // dt
    [(d) => d && d.pthKind === "cooling" ? "Puissance froid estimée" : "Puissance thermique estimée", "Puissance thermique estimée au PHE", (d) => d && d.pthKind === "cooling"
      ? "Estimation de la chaleur retirée : débit × (R4T−R1T) × 4,186 kJ/kg·K en supposant de l’eau. Dépend du débit, des capteurs et du fluide ; le glycol change le calcul. Affichée seulement avec compresseur en marche et écart dans le sens froid."
      : "Estimation de la chaleur transmise : débit × (R1T−R4T) × 4,186 kJ/kg·K en supposant de l’eau. Dépend du débit, des capteurs et du fluide ; le glycol change le calcul. Le BUH est après R1T et hors de cette valeur.", (d) => d.dtStale ? d.bsh === true
      ? "Aucun transfert calculable au PHE faute de circulation établie. La résistance interne peut encore chauffer le ballon, mais sa chaleur ne traverse pas R1T/R4T et ce bus ne peut pas la chiffrer."
      : "Aucune puissance calculable faute de mouvement d’eau établi au PHE. Il manque un point de travail ; cela ne signifie pas 0 kW."
      : d.pth == null ? null
      : d.pthKind === "cooling" ? `≈ ${fmt1(d.pth)} kW de froid${d.cop != null ? ` ; EER ${fmt1(d.cop)}` : ""}.`
      : `≈ ${fmt1(d.pth)} kW${d.cop != null && !d.copPostBuh ? ` ; COP ${fmt1(d.cop)}` : ""}.`], // pth
    [(d) => d && d.efficiencyKind === "eer" ? "EER estimé de la pompe à chaleur" : d && d.copScope === "plant" ? "COP estimé après BUH" : "COP estimé de la pompe à chaleur", "Rendement estimé", (d) => d && d.efficiencyKind === "eer"
      ? "Puissance froid estimée divisée par entrée électrique estimée. Hérite des incertitudes du fluide, des capteurs, de la tension et du facteur de puissance. EER instantané, non saisonnier ; l’énergie mesurée sur une saison est plus parlante."
      : "Puissance thermique estimée divisée par entrée électrique estimée, avec périmètres compatibles : après BUH avec CT et R2T, ou pompe à chaleur seule avec courant d’onduleur. Le câblage CT décide des charges incluses. Indication instantanée, pas compteur certifié.", (d) => d.copBlock === "tank_heater" ? "Aucun COP : la résistance du ballon peut être incluse dans l’électricité, mais sa chaleur va directement au ballon sans traverser les capteurs de départ ; les périmètres diffèrent."
      : d.copBlock === "buh_no_r2t" ? "Aucun COP : BUH actif sans capteur après lui. L’électricité peut inclure l’appoint alors que la chaleur est calculée avant."
      : d.copBlock === "mb_scope" ? "Aucun COP : HomeHub mesure l’électricité de toute l’unité, mais la chaleur du seul PHE et ne fournit ni états des appoints ni capteur aval pour accorder les périmètres."
      : d.copBlock === "no_pel" ? d.pelHeld ? "Aucun COP : compresseur arrêté, le courant d’onduleur vient du dernier cycle et n’est pas actuel." : "Aucun COP : ce profil ne fournit ni courant CT ni courant d’onduleur."
      : d.cop == null ? null
      : d.efficiencyKind === "eer" ? `${fmt1(d.cop)} kW de froid par kW électrique : ≈ ${fmt1(d.copPth)} kW retirés pour ≈ ${fmt1(d.pel)} kW absorbés.`
      : d.copScope === "plant" ? `${fmt1(d.cop)} kW thermiques après BUH par kW électrique estimé par CT : ≈ ${fmt1(d.copPth)} / ≈ ${fmt1(d.pel)} kW. Le câblage CT fixe les charges incluses.`
      : `${fmt1(d.cop)} kW thermiques par kW électrique dans le périmètre pompe à chaleur : ≈ ${fmt1(d.copPth)} / ≈ ${fmt1(d.pel)} kW. Le BUH est hors des deux valeurs.`], // cop
    ["Chauffage d’appoint · BUH", "Chauffage d’appoint BUH", "Appoint électrique du circuit d’eau placé après R1T. Ses étages peuvent relever le départ et la consommation ; ce n’est pas la résistance interne BSH du ballon.", (d) => d.buh1 == null && d.buh2 == null ? null : d.buh2 ? "Étage 2 : les deux étages chauffent." : d.buh1 ? "Étage 1 : un étage chauffe." : "Inactif : aucun étage BUH ne chauffe."], // buh
    ["Résistance du ballon", "Résistance électrique du ballon", "Résistance d’immersion BSH dans le ballon. Elle peut chauffer avec compresseur, pompe et débit à zéro ; son contact X10A ne mesure aucune puissance.", () => { const on = x10aDown() ? null : vOn(/^bsh$/i); return on == null ? null : on ? "Résistance du ballon active." : "Inactive : résistance du ballon arrêtée."; }], // bsh
    ["Vanne 3 voies", 0, "La sortie logique sélectionne le ballon ou les locaux. Ce n’est ni un retour mécanique de position ni une preuve de débit.", (d) => d.valveDhw == null ? null : d.valveDhw ? "La commande indique le ballon. Cela ne prouve ni position mécanique, ni débit, ni charge active." : "La commande indique les locaux. Cela ne prouve ni position mécanique ni circulation."], // valve
    ["Sortie vanne 2 voies", 0, "Sortie binaire X10A pour une 2WV du circuit locaux. Elle n’indique pas la position mécanique et n’équivaut pas au mode chauffage/froid.", (d) => d.valve2On == null ? null : d.valve2On ? "X10A indique la sortie 2WV active. Cela ne prouve ni chauffage actif ni position mécanique ; vérifier mode et fonctionnement des locaux." : "X10A indique la sortie 2WV inactive. Cela ne signifie pas à lui seul le froid et ne contredit pas un mode chauffage configuré, surtout au repos."], // valve2
    ["Ballon ECS", "Ballon ECS ou stockage thermique", "Ballon mesuré par R5T. Charge, consigne et résistance BSH sont affichées séparément."], // tank
    [(d) => activeSpaceKind(d) === "cool" ? "Circuit froid" : activeSpaceKind(d) === "heat" ? "Circuit chauffage" : "Circuit locaux", "Circuit des locaux", "Émetteurs du bâtiment : radiateurs, plancher ou ventilo-convecteurs. L’installation décide s’ils chauffent, refroidissent ou les deux ; R1T/R4T sont mesurés dans la pompe et ne confirment pas leur température.", (d) => d.valveDhw === true ? "Le chemin locaux n’est pas sélectionné ; pompe et débit indiquent séparément une éventuelle circulation vers le ballon."
      : waterMoving(d) ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0
        ? `De l’eau résiduelle chaude circule vers les locaux. R1T interne : ${degC(d.lwt)} ; aucun capteur aval ne confirme la température des émetteurs. Ce n’est pas du froid actif.`
        : `L’eau va vers le circuit ${activeSpaceKind(d) === "cool" ? "froid" : activeSpaceKind(d) === "heat" ? "chauffage" : "locaux"}. R1T interne : ${degC(d.lwt)} ; aucun capteur aux émetteurs.`
      : "Pompe et débit actuels ne prouvent aucune circulation dans la branche locaux."], // heat
    ["Fonctionnement des locaux", "Fonctionnement chauffage ou froid des locaux", "Signal de fonctionnement normal chauffage/froid des locaux. Ce n’est pas la demande du thermostat et il ne prouve pas à lui seul le fonctionnement du compresseur."], // spaceh
    ["Température ambiante", 0, "Température et consigne de la zone de référence ; elles dépendent du placement du capteur."], // room
    ["Circulateur", "Vitesse du circulateur", "Fait circuler l’eau dans la boucle commune et la branche choisie par la 3WV. Il peut rester actif compresseur arrêté pour post-circulation, protection ou égalisation ; vitesse et débit se lisent ensemble.", (d) => d.pump == null && d.flow == null && d.pumpOn == null ? null
      : pumpFlowConflict(d) ? `La pompe interne se dit arrêtée, mais le capteur mesure ${fmt1(d.flow)} l/min. Circulation externe, post-circulation ou signaux divergents sont possibles ; vérifier les deux.`
      : d.pump != null && d.pump > 0 ? d.flow != null ? `Vitesse ${fmt0(d.pump)} % ; débit mesuré ${fmt1(d.flow)} l/min.` : `Vitesse ${fmt0(d.pump)} %, mais aucun débit ; circulation non confirmée.`
      : waterMoving(d) ? `Le capteur mesure ${fmt1(d.flow)} l/min sans vitesse de pompe exploitable.`
      : d.pumpOn === true ? d.flow != null ? `Pompe active, mais seulement ${fmt1(d.flow)} l/min ; circulation non établie.` : "Pompe active, mais débit absent ; circulation non confirmée."
      : d.pumpOn === false || d.pump === 0 ? d.flow != null ? `Pompe arrêtée ; capteur à ${fmt1(d.flow)} l/min. Ces signaux ne prouvent aucune circulation.` : "Pompe arrêtée et aucun débit disponible."
      : `État pompe non fiable ; ${fmt1(d.flow)} l/min ne suffit pas à prouver la circulation.`], // pump
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
  "État de diagnostic de l’unité", // 21
  "Code défaut de l’unité", // 22
  "Sous-code défaut de l’unité", // 23
  "Circulateur actif", // 30
  "Compresseur actif", // 31
  "Résistance du ballon active", // 32
  "Désinfection du ballon active", // 33
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
  ["Le réchauffage remonte le ballon à sa consigne après passage sous le seuil de démarrage."], // 23
  ["Préréglage programmé : Confort emploie la cible haute et Éco la basse."], // 24
  ["Dans un système hybride, le régulateur demande l’ECS à la chaudière."], // 25
  ["3WV dirige l’eau vers ECS ou locaux ; 1=ECS et 0=locaux, sans prouver l’activité."], // 26
  ["Sortie X10A ON/OFF d’une 2WV optionnelle ; elle ne prouve ni mode, ni tension, ni position mécanique."], // 27
  ["Ouverture de la vanne mélangeuse d’une seconde zone."], // 28
  ["Cible de départ du mode chauffage ou froid sélectionné."], // 29
  ["Température de départ mélangée d’une zone secondaire, après sa vanne mélangeuse."], // 30
  ["Température après BUH, généralement R2T ; elle inclut son apport sans prouver la température aux émetteurs."], // 31
  ["R1T sort du PHE avant BUH ; avec R4T et débit, estime la puissance par mode, emplacement selon l’unité."], // 32
  ["Retour R4T au PHE ; évaluer le ΔT avec débit, compresseur et mode, jamais avec 5 K universels."], // 33
  ["Débit du circuit commun ; le minimum dépend du modèle et du mode, et une valeur basse peut causer 7H."], // 34
  ["Pression hydraulique : beaucoup de manuels exigent >1 bar ; à ≤1,0 bar consulter la notice du modèle exact."], // 35
  ["Commande de pompe inversée : 0 est la vitesse maximale et 100 l’arrêt."], // 36
  ["État pompe ; ne prouve pas la chaleur utile et peut agir sans compresseur : comparer au débit."], // 37
  ["État du circulateur d’un circuit solaire thermique configuré."], // 38
  ["Vitesse indiquée de la pompe nommée par ce profil."], // 39
  ["État X10A du fluxostat : ON indique un mouvement détecté, pas des l/min ni le minimum ; certains modèles ne documentent aucun contact physique."], // 40
  ["Mode hydraulique : arrêt, chauffage, froid, ECS ou combiné ; ne prouve ni compresseur ni transfert."], // 41
  ["Ordre Smart Grid à quatre états lu par HomeHub ou dérivé de deux contacts X10A ; ce n’est pas le mode chaud/froid."], // 42
  ["Mode locaux actif chauffage/froid, sans Auto ; ne prouve pas le compresseur et exige l’activité."], // 43
  ["Sélection HomeHub Auto/chauffage/froid ; configuration, pas état actuel ni preuve d’activité."], // 44
  ["État extérieur arrêt/chauffage/froid ; peut rester choisi compresseur arrêté et ne prouve pas la chaleur."], // 45
  ["Dégivrage extérieur ; normal par froid humide, mais ce bit seul ne diagnostique pas des cycles excessifs."], // 46
  ["Classe de gravité d’un défaut actif : Normal, Erreur, Avertissement ou Prudence."], // 47
  ["Signification du code de défaut actuellement signalé"], // 48
  ["Fonctionnement de secours après un défaut de pompe à chaleur."], // 49
  ["Relais d’alarme de l’unité ; il s’active pour signaler un défaut à une alarme ou supervision externe câblée."], // 50
  ["Température ambiante cible de la zone principale en chauffage ou froid."], // 51
  ["Demande interne « thermo ON » ; elle n’identifie pas la charge ni le compresseur, et « Space heating Operation » n’est pas une demande."], // 52
  ["Sortie électrique « Space H Operation » ; ni activité normale ni preuve du compresseur ou de chaleur."], // 53
  ["Activité normale chauffage/froid, pas demande ; peut être ON à froid avec compresseur arrêté."], // 54
  ["Température ambiante cible réglée pour la zone pilotée par le propre capteur de l’unité."], // 55
  ["Température ambiante mesurée par le capteur intégré ou câblé de l’unité."], // 56
  ["Protection refoulement : ON/OFF actuel + compteur 0–7 ; seule hausse comparable = activité, pas cause ; seuil/reset/retour 7→0 inconnus."], // 57
  ["Protection courant onduleur : ON/OFF actuel + compteur 0–7 ; seule hausse comparable = activité, pas cause ; seuil/reset/retour 7→0 inconnus."], // 58
  ["Protection haute pression : ON/OFF actuel + compteur 0–7 ; seule hausse comparable = activité, pas cause ; seuil/reset/retour 7→0 inconnus."], // 59
  ["Protection basse pression : ON/OFF actuel + compteur 0–7 ; seule hausse comparable = activité, pas cause ; seuil/reset/retour 7→0 inconnus."], // 60
  ["Protection thermique onduleur : ON/OFF actuel + compteur 0–7 ; seule hausse comparable = activité, pas cause ; seuil/reset/retour 7→0 inconnus."], // 61
  ["Bit interne générique de limitation non affecté aux cinq protections nommées."], // 62
  ["Température d’eau à l’entrée ou à la sortie du PHE, qui transfère la chaleur entre frigorigène et circuit hydraulique."], // 63
  ["Capteur de l’échangeur extérieur ; <0 °C peut être normal et sans humidité ne prouve pas le givre."], // 64
  ["Température extérieure mesurée par l’unité, utilisable pour loi d’eau et décisions de fonctionnement."], // 65
  ["Gaz chaud en sortie compresseur ; dépend de la pression, vitesse, mode et charge. Une valeur ou plage d’une autre famille ne prouve ni défaut ni manque de fluide."], // 66
  ["Température du gaz frigorigène froid à basse pression revenant au compresseur."], // 67
  ["Température du fluide frigorigène sur la ligne liquide entre les échangeurs."], // 68
  ["Température du frigorigène entrant/sortant de l’évaporateur, l’échangeur qui absorbe la chaleur."], // 69
  ["Température de la ligne d’injection de frigorigène, utilisée en interne pour piloter l’injection et protéger le cycle."], // 70
  ["Température d’une zone diphasique, liquide et vapeur, du circuit frigorifique."], // 71
  ["Capteur de dégivrage extérieur ; position et contrôle selon le modèle. Un point ne prouve ni le givre de toute la batterie ni la fin du dégivrage."], // 72
  ["Température de saturation calculée depuis la pression ; ce n’est ni un capteur séparé ni une pression en bar."], // 73
  ["Pression haute/basse : juger une tendance stable au même mode/modèle ; démarrage, retour d’huile et dégivrage la changent. Pas de plage universelle."], // 74
  ["Vitesse compresseur en rps ; dépend du modèle, une hausse demande souvent plus, sans mesurer la chaleur."], // 75
  ["Commande EEV en pas, sans retour mécanique, ni % ni débit. Seule, elle ne prouve ni mouvement, blocage ni manque de fluide."], // 76
  ["Température de l’électronique de commande du moteur du ventilateur extérieur."], // 77
  ["Vitesse du ventilateur extérieur, en étage ou tr/min."], // 78
  ["Cible interne selon modèle/mode ; comparer à la saturation issue de la pression correspondante. L’écart ne diagnostique ni cause ni charge."], // 79
  ["Cible interne de température de refoulement/port du compresseur, utilisée par les protections de l’unité."], // 80
  ["ΔT cible entre départ et retour ; il dépend du modèle et du mode, pas d’une règle universelle de 5 K."], // 81
  ["Fluide frigorigène chargé, par exemple R32 ou R410A."], // 82
  ["Température mesurée à un port du compresseur pour sa surveillance et sa protection internes."], // 83
  ["Mesure de pression du circuit frigorifique de l’unité extérieure."], // 84
  ["Courant de phase par CT ; l’estimation à 230 V n’est pas étalonnée et ignore tension réelle et facteur de puissance."], // 85
  ["Courant absorbé par l’onduleur du compresseur, indicateur approximatif de son effort."], // 86
  ["Température du dissipateur de l’onduleur/électronique de puissance extérieure."], // 87
  ["Étage(s) actif(s) de l’appoint électrique, exprimés comme niveau de puissance."], // 88
  ["Puissance BUH : 0=aucune ; un niveau supérieur peut aider par grand froid, dégivrage, ECS ou secours selon réglages."], // 89
  ["Entrée HomeHub 32 : état ON/OFF de BSH, pas sa puissance ; l’entrée 51 est la consommation de la pompe à chaleur, pas de BSH."], // 90
  ["BSH du ballon peut chauffer sans compresseur ni pompe ; X10A donne ON/OFF, pas la puissance."], // 91
  ["État de la chaîne de protection thermique d’un chauffage électrique, destinée à interrompre son fonctionnement à l’ouverture."], // 92
  ["Antigel des conduites ; il dépend du modèle, exige du courant et ne protège pas pendant une coupure."], // 93
  ["État antigel X10A ; sans données du modèle il n’identifie ni pompe, ni résistance, ni zone protégée."], // 94
  ["Circuit géothermique de saumure et sa pompe ; fluide, pression et limites dépendent du plan et de la notice."], // 95
  ["Source hybride pompe/combinée/chaudière ; c’est une sélection, pas une chaleur mesurée."], // 96
  ["Cible de départ hybride, pas température mesurée ; à lire avec mode et valeurs réelles."], // 97
  ["Autorisation/état bivalent ; ON ne prouve pas que la chaudière brûle."], // 98
  ["Demande chaudière ; ne prouve ni brûleur ni chaleur livrée."], // 99
  ["Cible d’eau chaudière, pas température mesurée ; dépend de la demande et de l’installation."], // 100
  ["Valeur bivalente BE_COP ; sens et échelle X10A non documentés, ce n’est pas le COP actuel."], // 101
  ["Entrée tarif, Smart Grid ou solaire ; l’action dépend du réglage et ON indique seulement le contact."], // 102
  ["Puissance nominale/classe fixe intérieure ou extérieure, en kW ou code ; pas une mesure actuelle."], // 103
  ["Le mode silencieux réduit le bruit extérieur selon le niveau choisi et peut diminuer la capacité de chauffage ou de froid."], // 104
  ["État HomeHub Sans erreur/Défaut/Avertissement ; il n’identifie pas seul la cause."], // 105
  ["Signification du code de défaut actuellement signalé"], // 106
  ["Sous-code complémentaire ; valable avec état/code principal, masqué s’il est indisponible."], // 107
  ["HomeHub donne compresseur ON/OFF, pas vitesse ni puissance ; à lire avec opération et débit."], // 108
  ["Indique si le fonctionnement ECS normal est actif."], // 109
  ["Indique si le fonctionnement normal chauffage ou froid des locaux est actif."], // 110
  ["Sortie PHE avant BUH ; à comparer au retour seulement en circulation pour obtenir le ΔT."], // 111
  ["Départ après BUH ; une hausse peut être électrique, à confirmer par l’état BUH."], // 112
  ["Température de l’eau mesurée dans le ballon ECS."], // 113
  ["Température de ligne liquide ; sa relation dépend du mode et une valeur isolée ne diagnostique pas."], // 114
  ["Température ambiante de la zone principale signalée par la télécommande."], // 115
  ["Puissance électrique via HomeHub ; elle dépend du mode et des charges et ne doit pas être attribuée au seul compresseur."], // 116
  ["Cible départ chauffage HomeHub, en lecture seule : fixe ou climatique ; la baisser n’aide que si la consigne ambiante reste atteinte."], // 117
  ["Cible départ froid HomeHub, en lecture seule : pertinente si froid permis et actif ; peut rester visible sinon."], // 118
  ["Indique si le circuit des locaux est autorisé : c’est l’interrupteur, pas l’activité actuelle."], // 119
  ["Le fonctionnement silencieux réduit le bruit extérieur selon le niveau réglé et peut diminuer la capacité disponible."], // 120
  ["Cible de réchauffage ECS, pas le seuil de départ ; hystérésis et programme comptent aussi."], // 121
  ["Correction −10…+10 K de la cible chauffage ; elle ne prouve aucune chaleur sans fonctionnement des locaux."], // 122
  ["Limite de stockage en Marche recommandée ; la plus basse avec la générale prévaut, sans être la consommation."], // 123
  ["Plafond général HomeHub, pas consommation ; le baisser restreint tous les modes Smart Grid."], // 124
]);

MODEL_DESCRIPTION_I18N.fr = modelDescriptionValues([
  ["État propre erreur/avis : erreur active donne AVERTISSEMENT ; avis ou message effacé sous 24 h donne NOTE, sans inférence du projet."], // health_fault
  ["Perte calme : seuil projet, NOTE ≥0,8 K/h ; volume/ΔT influent, >≈1,85 K/h peut être filtré comme usage et OK ne prouve pas l’isolation."], // health_dhw_loss
  ["NOTE : ≥12 cycles chauffage, moyenne <10 min ; ECS/froid exclus, seuil projet non Daikin ; si trop sont non classés, tous jugés ensemble."], // health_cycling
  ["Compte les dégivrages : NOTE au-delà de 15 % avec ≥3 cycles ; pas une limite Daikin. R4T est un contexte en direct hors verdict ; un point ne décrit pas toute la batterie."], // health_defrost
  ["Pression minimale : >1,0 bar ; ≤1,0 donne NOTE puis AVERTISSEMENT après 60 s, mais la plage dépend du modèle."], // health_pressure
  ["Débit après 60 s de pompe : tronçon mesuré, pas débit de calcul ; comparer mêmes modèle/mode/conditions, sans seuil universel."], // health_flow
  ["Durée BUH/BSH observée : froid, secours, dégivrage, ECS ou surplus peuvent l’expliquer ; aucune limite universelle."], // health_heater
  ["5 compteurs expérimentaux peu documentés : seule une hausse comparable donne NOTE, pas diagnostic ; sans hausse, une limitation reste possible."], // health_retries
  ["RAM libre actuelle et tendance sur 24 h : une baisse durable peut signaler des allocations retenues. Un redémarrage sous tension conserve la tendance en RAM ; un redémarrage normal, une mise à jour ou une coupure restaure depuis le flash les tranches closes de 5 min. Seule la tranche ouverte peut manquer."], // free_heap
  ["Plus grand bloc contigu requis par TLS/OTA ; sa baisse avec RAM totale stable indique une fragmentation."], // max_alloc
  ["Puissance nominale de l’unité extérieure, pas sa production actuelle."], // capacity
  ["Puissance nominale de l’UNITÉ INTÉRIEURE ; ne pas l’attribuer à l’extérieure ou au système complet."], // capacity_iu
  ["Plusieurs familles partagent registres et puissance : les valeurs restent valides, mais le modèle exact exige de comparer l’ID à la plaque."], // candidates
  ["Sans puissance extérieure les candidats peuvent différer ; la meilleure correspondance intérieure est utilisée sans certitude, à vérifier sur la plaque."], // candidates_nocap
  ["Octets d’identification extérieure sans table publique des noms ; en cas d’ambiguïté, les comparer à la plaque."], // oueeprom
]);
