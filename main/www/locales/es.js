// translation-source: 5168982ac8a7dbd59eda7c9c9076626f265279f5292a597c01c727c875cd59bc
I18N.es = localeValues([
  /* sys.nodata */ "Sin datos",
  /* sys.unreachable */ "No accesible",
  /* sys.x10a_down */ "X10A sin conexión",
  /* sys.mb_carrying */ "Modo de funcionamiento desconocido — lecturas de Modbus",
  /* sys.mb_only */ "X10A sin conexión — lecturas de Modbus",
  /* sys.mb_source */ "X10A sin conexión · Modbus",
  /* mode.stop */ "Parada",
  /* mode.heat */ "Calefacción",
  /* mode.cool */ "Refrigeración",
  /* mode.space */ "Climatización",
  /* mode.dhw */ "Agua caliente",
  /* mode.heat_dhw */ "Calefacción + agua caliente",
  /* mode.cool_dhw */ "Refrigeración + agua caliente",
  /* mode.space_dhw */ "Climatización + agua caliente",
  /* sys.unreachable_sub */ "No se puede acceder al dispositivo — reintentando…",
  /* sys.waiting */ "Esperando a la bomba de calor…",
  /* sys.operating */ "En funcionamiento",
  /* sys.standby */ "En espera — sin funcionar",
  /* sys.defrosting */ "Desescarche",
  /* sys.circulating */ "Circulación — compresor apagado",
  /* sys.cool_mode */ "Modo de refrigeración",
  /* sys.residual_circulating */ "Circulación de calor residual — sin potencia frigorífica",
  /* sys.bsh_active */ "Calentador eléctrico del depósito activo",
  /* sys.online */ "En línea",
  /* sys.fault */ "Fallo",
  /* sys.warning */ "Aviso",
  /* sys.fault_line */ (c) => "Fallo · " + c + " — comprueba el código de fallo de Daikin.",
  /* sys.warning_line */ (c) => "Aviso · " + c + " — comprueba la bomba de calor.",
  /* sys.polled */ (s) => `Consultado hace ${s} s`,
  /* recovery.title */ "Modo de recuperación",
  /* recovery.meta_heap */ "El dispositivo se quedó sin memoria repetidamente y se reinició. Ahora funciona con la conexión a la bomba de calor y MQTT desactivados para que la interfaz web siga accesible. Es muy probable que la configuración sea correcta: instala una versión de firmware más reciente en Ajustes. Un ciclo de alimentación vuelve a intentar iniciar todos los componentes.",
  /* recovery.meta */ "El dispositivo se reinició repetidamente y entró en modo de recuperación. La comunicación con la bomba de calor y MQTT está en pausa. Comprueba la configuración, especialmente los pines RX/TX de la tarjeta Protocolo en Ajustes, y reinicia el dispositivo.",
  /* rollback.title */ "Falló el cambio de WiFi — se restauró la configuración anterior",
  /* rollback.meta */ (back) => `El dispositivo no pudo conectarse con la nueva configuración WiFi. Restauró la red anterior${back} y se reinició. Comprueba el nombre y la contraseña de la red en Ajustes → Conexiones y vuelve a intentarlo.`,
  /* crash.title_fault */ "El dispositivo se reinició tras un fallo",
  /* crash.title_orphan */ "Hay un informe de fallo pendiente de un reinicio anterior",
  /* crash.reset */ "Reinicio",
  /* crash.task */ "tarea",
  /* crash.fw */ "fw",
  /* crash.elf */ "elf",
  /* crash.corrupted */ "dañado",
  /* crash.download */ "Descargar informe de fallo",
  /* crash.copy */ "Copiar diagnóstico",
  /* crash.dismiss */ "Eliminar informe",
  /* crash.copied */ "Diagnóstico copiado — pégalo en un informe de error",
  /* crash.copy_fail */ "No se pudo copiar — abre /coredump y /diag manualmente",
  /* crash.ask_dump */ "¿Eliminarlo del dispositivo? También se borrará el volcado de memoria; descárgalo antes para incluirlo en un informe de error.",
  /* crash.ask */ "¿Eliminar este informe del dispositivo?",
  /* crash.ask_yes */ "Eliminar",
  /* crash.ask_no */ "Conservar",
  /* crash.deleted */ "Informe de fallo eliminado",
  /* crash.delete_fail */ "El dispositivo no pudo eliminarlo — el informe sigue ahí",
  /* bug.row */ "Informar de un error",
  /* bug.title */ "Informar de un error",
  /* bug.intro */ "Describe brevemente el problema. El dispositivo añadirá su estado, lecturas y registro tras eliminar nombres de red, direcciones y nombres de servidor.",
  /* bug.what */ "Qué ocurre",
  /* bug.what_ph */ "Desde esta mañana, la temperatura del depósito muestra 12800 °C en Home Assistant.",
  /* bug.need_text */ "Describe primero qué ocurre; basta con una o dos frases.",
  /* bug.continue */ "Preparar el informe",
  /* bug.step2_title */ "Revisar el informe",
  /* bug.step2 */ "Revisa el informe de abajo. El botón lo copia y abre el formulario de incidencia de GitHub con tu descripción ya rellenada. Pega el informe en «Device report», responde a las preguntas restantes y envía la incidencia.",
  /* bug.collecting */ "Recopilando datos del dispositivo…",
  /* bug.collect_fail */ "No se pudo leer el dispositivo; el informe de abajo indica qué partes faltan.",
  /* bug.copy */ "Copiar y abrir GitHub",
  /* bug.download */ "Descargar .md",
  /* bug.md_hint */ "Si falla la copia o prefieres un archivo, descarga el mismo informe como .md. Arrastra el archivo al campo «Device report» del formulario en lugar de pegar el texto.",
  /* bug.copied */ "Informe copiado — pégalo en el campo «Device report»",
  /* bug.copy_fail */ "No se pudo copiar — selecciona el texto de abajo y cópialo manualmente",
  /* bug.redacted */ "Ya se han eliminado el nombre de tu red, las direcciones, el bróker y los nombres de servidor.",
  /* nav.settings */ "Ajustes",
  /* nav.back */ "Atrás",
  /* nav.settings_alert */ (n) => `Ajustes — ${n} ${n === 1 ? "conexión caída" : "conexiones caídas"}`,
  /* src.modbus_tag */ "modbus",
  /* src.agree */ "Ambas fuentes coinciden",
  /* src.delta */ (d, u) => `Diferencia ${d}${u ? " " + u : ""}`,
  /* src.disagree */ "Las dos fuentes discrepan sobre este estado",
  /* conn.homehub */ "HomeHub",
  /* conn.searching */ "Buscando…",
  /* group.Modbus */ "Modbus",
  /* conn.title */ "Conexiones",
  /* conn.offline */ "Sin conexión",
  /* conn.disabled */ "Desactivado",
  /* conn.connecting */ "Conectando…",
  /* conn.connected */ "Conectado",
  /* conn.resolving */ "Resolviendo…",
  /* conn.eth_no_cable */ "Sin cable",
  /* conn.eth_no_lease */ "Cable conectado, sin dirección",
  /* conn.eth_fd */ "dúplex completo",
  /* conn.enabled */ "Activado",
  /* conn.enabled_noping */ "Activado, el host no responde al ping",
  /* conn.synced */ "Sincronizado",
  /* conn.syncing */ "Sincronizando…",
  /* conn.error */ (e) => "Error: " + e,
  /* conn.connected_to */ (s) => "Conectado a " + s,
  /* conn.aria */ (label, state) => `${label}: ${state}. Toca para editar.`,
  /* modbus.err.mdns_not_found */ "No se encontró ningún HomeHub mediante mDNS.",
  /* modbus.err.no_address */ "No hay ninguna dirección de HomeHub configurada.",
  /* modbus.err.resolve_failed */ "No se pudo resolver la dirección del HomeHub.",
  /* modbus.err.connect_timeout */ "Tiempo de conexión agotado — no se puede acceder al HomeHub.",
  /* modbus.err.connection_refused */ "HomeHub accesible, pero el puerto Modbus TCP está cerrado.",
  /* modbus.err.network_unreachable */ "No hay ninguna ruta de red hasta el HomeHub.",
  /* modbus.err.host_unreachable */ "No se puede acceder al HomeHub en la red.",
  /* modbus.err.connect_failed */ "Falló la conexión con el HomeHub.",
  /* modbus.err.request_failed */ (r) => `No se pudo crear la solicitud Modbus${r ? ` para el registro ${r}` : ""}.`,
  /* modbus.err.send_timeout */ (r) => `Se agotó el tiempo al enviar la solicitud Modbus${r ? ` en el registro ${r}` : ""}.`,
  /* modbus.err.send_failed */ (r) => `No se pudo enviar la solicitud Modbus${r ? ` en el registro ${r}` : ""}.`,
  /* modbus.err.response_timeout */ (r) => `Se agotó el tiempo de respuesta del HomeHub${r ? ` en el registro ${r}` : ""}.`,
  /* modbus.err.connection_closed */ (r) => `El HomeHub cerró la conexión${r ? ` en el registro ${r}` : ""}.`,
  /* modbus.err.receive_failed */ (r) => `No se pudo leer la respuesta del HomeHub${r ? ` en el registro ${r}` : ""}.`,
  /* modbus.err.invalid_response */ (r) => `Respuesta Modbus no válida${r ? ` en el registro ${r}` : ""}.`,
  /* modbus.err.internal_error */ "El ciclo de consulta Modbus falló internamente.",
  /* modbus.err.exception */ (r, n, why) => `HomeHub rechazó el registro ${r || "?"} (excepción ${n}: ${why}).`,
  /* modbus.exc.1 */ "función no permitida",
  /* modbus.exc.2 */ "dirección de datos no permitida",
  /* modbus.exc.3 */ "valor de datos no permitido",
  /* modbus.exc.4 */ "fallo del dispositivo",
  /* modbus.exc.5 */ "solicitud confirmada",
  /* modbus.exc.6 */ "dispositivo ocupado",
  /* modbus.exc.8 */ "error de paridad de memoria",
  /* modbus.exc.10 */ "ruta de pasarela no disponible",
  /* modbus.exc.11 */ "el destino no respondió",
  /* modbus.exc.unknown */ "motivo desconocido",
  /* card.model */ "Modelo",
  /* card.hplink */ "Conexión con la bomba de calor",
  /* card.online */ "En línea",
  /* card.uptime */ "Tiempo activo",
  /* card.freeheap */ "Memoria libre",
  /* card.maxalloc */ "Mayor bloque libre",
  /* card.offline */ "Sin conexión",
  /* card.protocol */ "Protocolo",
  /* card.rxpin */ "Pin RX",
  /* card.txpin */ "Pin TX",
  /* card.capacity */ "Capacidad",
  /* card.hplink_help */ "Indica si el ESP32 está recibiendo respuestas válidas de la bomba de calor mediante X10A.",
  /* card.protocol_help */ "X10A-I y X10A-S son los dos formatos de trama de la interfaz de servicio compatibles. El firmware detecta el formato a partir de respuestas válidas.",
  /* card.rxpin_help */ "GPIO en el que el ESP32 recibe datos X10A de la bomba de calor. Mientras la conexión está caída, el selector inicia un nuevo intento de detección automática con el par elegido.",
  /* card.txpin_help */ "GPIO por el que el ESP32 envía solicitudes X10A a la bomba de calor. RX y TX deben ser distintos y coincidir con el cableado físico.",
  /* card.capacity_iu */ "Capacidad (unidad interior)",
  /* card.candidates */ "Modelos posibles",
  /* card.oueeprom */ "ID de la unidad exterior",
  /* card.checkup */ "Diagnóstico de la instalación · 24 h",
  /* service.title */ "Circuito frigorífico durante la calefacción",
  /* service.state.waiting */ "ESPERA CALEFACCIÓN",
  /* service.state.observing */ "REGISTRANDO",
  /* service.state.limited */ "REGISTRANDO · FALTAN DATOS",
  /* service.state.interrupted */ "EN PAUSA",
  /* service.row.window */ "Registrado hasta ahora",
  /* service.row.reason */ "¿Por qué este estado?",
  /* service.reason.unsupported_profile */ "Este modelo no proporciona todas las lecturas necesarias.",
  /* service.reason.compressor_not_running */ "El compresor no está funcionando.",
  /* service.reason.unsupported_or_unknown_mode */ "La bomba de calor no está en calefacción normal o no se puede leer el modo.",
  /* service.reason.dhw_path */ "La bomba de calor está calentando el agua sanitaria.",
  /* service.reason.defrost */ "La unidad exterior se está desescarchando.",
  /* service.reason.unit_fault */ "La bomba de calor está indicando un fallo.",
  /* service.reason.special_controller_phase */ "Hay una breve fase de arranque o control especial.",
  /* service.reason.missing_fresh_signal */ "Falta al menos una lectura actual necesaria.",
  /* service.reason.poll_gap */ "La conexión X10A se interrumpió o pausó intencionadamente.",
  /* service.window */ (d, n) => `${d} · ${n} ${n === 1 ? "lectura actual" : "lecturas actuales"}`,
  /* service.help.observing */ "Ahora se registran valores de forma continua durante una calefacción normal.",
  /* service.help.limited */ "El registro está activo, pero faltan algunas lecturas adicionales para comparar.",
  /* service.help.interrupted */ "El registro terminó y se reinicia automáticamente en la próxima calefacción adecuada.",
  /* service.common */ "En modelos compatibles comienza automáticamente con calefacción normal; sin modo de servicio ni cambios. No evalúa refrigerante ni rangos normales. Valor de válvula: orden, no posición medida.",
  /* check.fault */ "Fallo de la unidad",
  /* check.dhw_loss */ "Pérdida de calor del depósito de ACS",
  /* check.cycling */ "Arranques del compresor",
  /* check.defrost */ "Ciclos de desescarche",
  /* check.pressure */ "Presión de agua, mínima",
  /* check.flow */ "Caudal, mínimo",
  /* check.heater */ "Calentador auxiliar",
  /* check.retries */ "Reintentos de protección",
  /* check.status.ok */ "OK",
  /* check.status.info */ "NOTA",
  /* check.status.warn */ "AVISO",
  /* check.status.collecting */ "COMPROBANDO",
  /* check.status.observation */ "SOLO MEDICIÓN",
  /* check.status.experimental */ "EXPERIMENTAL",
  /* check.status.unavailable */ "NO DISPONIBLE",
  /* check.summary */ (s, n, a) => a > 0 ? `${s} · ${n}/${a} evaluados` : s,
  /* check.detail.value_label */ "Valor:",
  /* check.detail.assessment_label */ "Evaluación:",
  /* check.detail.ok */ "Evaluación completa; no hay hallazgos en los datos observados de la instalación.",
  /* check.detail.info */ "Conviene saberlo, pero no demuestra un defecto. Lo que aquí se considera destacable figura en «Normal» más abajo.",
  /* check.detail.warn */ "Un hallazgo del dispositivo o un límite documentado requiere atención.",
  /* check.detail.fault.error */ "La unidad está notificando un error. El código exacto aparece en la tarjeta «Funcionamiento».",
  /* check.detail.fault.warning */ "La unidad está notificando un aviso o una precaución, no un error. El código exacto aparece en la tarjeta «Funcionamiento».",
  /* check.detail.fault.past */ "Ahora no se notifica nada. Durante las últimas 24 horas apareció un mensaje que desapareció por sí solo, por eso esta fila no indica OK. No hace falta actuar ante un mensaje ya borrado; si reaparece, anota cuándo ocurre.",
  /* check.detail.fault.past_unknown */ "Apareció un mensaje durante las últimas 24 horas. No se puede saber si sigue activo: la fila de fallos no responde, así que comprueba la conexión X10A.",
  /* check.detail.collecting */ (n, r) => `${n} de ${r} capturados; todavía no es posible evaluar.`,
  /* check.detail.cycling_split */ " Aquí solo se evalúa la calefacción de espacios confirmada. Los ciclos de agua caliente tienen otras restricciones; se excluye la refrigeración identificada con certeza. Se cuenta por ciclo completo: la válvula de 3 vías y, en el circuito de climatización, el modo de funcionamiento de la U/I deben permanecer legibles y sin cambios durante todo el ciclo. Todo lo demás queda sin clasificar y no se evalúa.",
  /* check.detail.cycling_pooled */ " Se evalúan todos los ciclos juntos porque las pruebas de clasificación fueron insuficientes: una entrada era demasiado escasa, se clasificaron menos de 12 ciclos o más del 10 % de los ciclos completos quedaron sin clasificar. Por tanto, el agua caliente o la refrigeración pueden ocultar ciclos cortos de calefacción. Las cifras de clase contiguas son observaciones y no determinaron el veredicto.",
  /* check.detail.outdoor_cycling */ " Las cifras exteriores de X10A solo incluyen muestras recientes de ciclos de calefacción de espacios completos y clasificados de forma coherente. Sirven de contexto y no cambian el umbral de ciclos ni el veredicto.",
  /* check.detail.outdoor_defrost */ " Las cifras exteriores de X10A solo incluyen muestras recientes cuando tanto el estado de desescarche como el del compresor eran legibles y el compresor estaba funcionando. Sirven de contexto y no cambian el umbral de desescarche ni el veredicto.",
  /* check.detail.dhw_candidate */ (n, r, c, w) => `${n} de ${r} completados en ventanas limpias de una hora; ventana limpia actual: ${c} de ${w}.`,
  /* check.detail.dhw_settling */ (n, r, s) => `${n} de ${r} completados en ventanas limpias de una hora; se detectó carga del depósito o BSH, quedan ${s} de estabilización.`,
  /* check.detail.dhw_waiting */ (n, r) => `${n} de ${r} completados en ventanas limpias de una hora; aún no hay ninguna ventana limpia completa de una hora.`,
  /* check.detail.dhw_aborted */ (n, reasons, best) => ` ${n} ${n === 1 ? "ventana candidata descartada" : "ventanas candidatas descartadas"} (${reasons}); la más larga alcanzó ${best} de 60 min.`,
  /* check.detail.dhw_blocked */ (n, reasons, best) => `No evaluable con este método: durante 24 horas completas no terminó ninguna ventana limpia de una hora y ${n === 1 ? "se descartó 1 ventana candidata" : `se descartaron ${n} ventanas candidatas`} (${reasons}); la más larga alcanzó ${best} de 60 min. La carga del depósito necesita 105 minutos sin interrupciones (45 min de estabilización más una ventana de 60 minutos); las extracciones, la actividad de la bomba, datos ilegibles o una pérdida continua de calor suficientemente rápida para parecer una extracción también pueden impedir una hora limpia. Los totales guardados no muestran qué causa predominó, por lo que no se puede descartar una pérdida continua y rápida de calor.`,
  /* check.detail.dhw_blocked_link */ (n, best) => `No evaluable: durante 24 horas completas no terminó ninguna ventana limpia de una hora y ${n === 1 ? "se descartó la única ventana candidata" : `se descartaron las ${n} ventanas candidatas`} porque la conexión X10A dejó de responder a mitad de la ventana; la más larga alcanzó ${best} de 60 min. Es un problema de conexión, no de la instalación: comprueba el cableado X10A y los pines RX/TX.`,
  /* check.detail.dhw_reason.charge */ "carga del depósito",
  /* check.detail.dhw_reason.pump */ "bomba interna",
  /* check.detail.dhw_reason.draw */ "caída similar a una extracción",
  /* check.detail.dhw_reason.reading */ "R5T no plausible",
  /* check.detail.dhw_reason.blind */ "X10A no responde",
  /* check.detail.collecting_unknown */ "Aún no hay suficientes pruebas utilizables para realizar una evaluación.",
  /* check.detail.observation */ "Solo valor medido; no existe un límite universal de OK/AVISO.",
  /* check.detail.experimental */ "Observación experimental; un contador estable no demuestra que no se produjera ninguna limitación.",
  /* check.detail.unavailable */ "El perfil activo no proporciona datos evaluables para esta comprobación.",
  /* check.starts */ (n) => `${n} ${n === 1 ? "arranque" : "arranques"}`,
  /* check.cycles */ (n) => `${n} ${n === 1 ? "ciclo" : "ciclos"}`,
  /* check.paired_cycles */ (n) => `${n} ${n === 1 ? "emparejado" : "emparejados"}`,
  /* check.mean */ (d) => `${d}/arranque`,
  /* check.cycling_space */ (n, d) => d ? `climatización ${n} × ${d}` : `climatización ${n}`,
  /* check.cycling_dhw */ (n, d) => d ? `agua caliente ${n} × ${d}` : `agua caliente ${n}`,
  /* check.cycling_cooling */ (n) => `refrigeración: ${n === 1 ? "se excluyó 1" : `se excluyeron ${n}`}`,
  /* check.cycling_censored */ (n) => `${n} sin clasificar`,
  /* check.outdoor_one */ (source, mean) => `${source} ${mean} °C`,
  /* check.outdoor_range */ (source, min, mean) => `${source} mín. ${min} °C · media ${mean} °C`,
  /* check.min */ (m) => `${m} min`,
  /* check.tank */ (m) => `depósito ${m} min`,
  /* check.tank_runtime */ (d) => `depósito ${d}`,
  /* check.loss_windows */ (n) => `${n} ${n === 1 ? "ventana" : "ventanas"}`,
  /* check.loss_pump_off */ "también con la bomba de circulación apagada",
  /* check.loss_with_pump */ "durante el funcionamiento de la bomba de circulación",
  /* check.loss_unattributed */ "atribución de la bomba incompleta",
  /* check.fault_err */ "Fallo activo",
  /* check.fault_warn */ "Aviso activo",
  /* check.fault_past */ "Ocurrió en las últimas 24 h · ya no está activo",
  /* check.fault_none */ "Ninguno activo",
  /* check.fault_unknown */ "Estado actual desconocido",
  /* check.fault_past_unknown */ "Ocurrió en las últimas 24 h · estado actual desconocido",
  /* check.retry_seen */ "Se observó un aumento del contador",
  /* check.retry_none */ "No se observó ningún aumento",
  /* values.waiting */ "Esperando la primera consulta…",
  /* values.sg_x10a_mode */ "Modo Smart Grid (contactos X10A)",
  /* group.Operation */ "Funcionamiento",
  /* group.Domestic hot water */ "Agua caliente sanitaria",
  /* group.Water circuit */ "Circuito de agua",
  /* group.Refrigerant / outdoor */ "Refrigerante / exterior",
  /* group.Electrical */ "Electricidad",
  /* group.Device */ "Dispositivo",
  /* group.Other values */ "Otros valores",
  /* group.Protection */ "Protección",
  /* protect.limiting */ "limitando ahora",
  /* group.Values */ "Valores",
  /* state.on */ "ACTIVO",
  /* state.off */ "PARADO",
  /* enum.auto */ "Auto",
  /* enum.heating */ "Calefacción",
  /* enum.cooling */ "Refrigeración",
  /* enum.no_error */ "Sin errores",
  /* enum.fault */ "Fallo",
  /* enum.warning */ "Aviso",
  /* enum.space_heating */ "Calefacción de espacios",
  /* enum.dhw */ "ACS",
  /* enum.free_running */ "Funcionamiento libre",
  /* enum.forced_off */ "Apagado forzado",
  /* enum.recommended_on */ "Encendido recomendado",
  /* enum.forced_on */ "Encendido forzado",
  /* enum.unknown */ (n) => `Desconocido (${n})`,
  /* chip.space_on */ "Clima activo",
  /* chip.space_off */ "Clima parado",
  /* chip.quiet */ "Silencioso",
  /* schem.sg_boost */ "REFUERZO",
  /* sg.mode0 */ "Libre",
  /* sg.mode1 */ "Parada forzada",
  /* sg.mode2 */ "Marcha recomendada",
  /* sg.mode3 */ "Marcha forzada",
  /* schem.to_dhw */ "3WV → ACS",
  /* schem.to_space */ "3WV → climatización",
  /* normal.label */ "Normal:",
  /* meaning.label */ "Cómo interpretarlo:",
  /* hist.title */ "Últimas 24 horas",
  /* hist.recorded */ (h) => `Registrado · ${h} h`,
  /* hist.now */ "ahora",
  /* hist.ago */ (h) => `hace ${h} h`,
  /* hist.loading */ "Cargando tendencia…",
  /* hist.none */ "Aún no hay lecturas registradas.",
  /* hist.err */ "Tendencia no disponible.",
  /* hist.gaps */ (n) => `${n} ${n === 1 ? "intervalo" : "intervalos"} sin datos — no medido`,
  /* hist.nm */ "no medido",
  /* hist.rel */ (h) => `hace ${h} h`,
  /* hist.held */ "unidad exterior en reposo",
  /* hist.heldnote */ (h) => `${h} h en reposo — no medido`,
  /* hist.forecast */ "Open-Meteo · previsión",
  /* hist.in_hours */ (h) => `dentro de ${h} h`,
  /* hist.aria */ (l) => `${l} — tendencia de 24 horas. Las flechas permiten leer muestras individuales.`,
  /* hist.aria_pinned */ (l, r) => `${l} — tendencia de 24 horas. Lectura fijada: ${r}. Tócala de nuevo para quitarla.`,
  /* hist.pin_hint */ "toca para fijar",
  /* hist.duration_min */ (m) => `${m} min`,
  /* hist.duration_h */ (h) => `${h} h`,
  /* hist.duration_hm */ (h, m) => `${h} h ${m} min`,
  /* hist.duration_sec */ (s) => `${s} s`,
  /* hist.state_phase_run */ (state, when, d) => `${state}\n${when} · aprox. ${d}`,
  /* hist.state_active */ "Activo",
  /* hist.state_off */ "Apagado",
  /* val.since */ (d) => `durante ${d}`,
  /* val.since_min */ (d) => `\u2265 ${d}`,
  /* val.since_gap */ (d) => `${d} sin observación`,
  /* hist.modbus_plateau */ (when, d) => `registro sin cambios ${when} · aprox. ${d} · antigüedad de la medición desconocida`,
  /* hist.boost_total */ (d) => `Refuerzo · ${d}`,
  /* hist.boost_none */ "Ningún refuerzo en el periodo registrado.",
  /* hist.boost_ago_range */ (a, b) => `hace ${a}–${b} h`,
  /* hist.boost_active */ "Refuerzo activo",
  /* hist.boost_inactive */ "Refuerzo inactivo",
  /* hist.boost_aria */ (l, d) => `${l} — cronología del estado Smart Grid con los cuatro modos. ${d}. Las flechas permiten leer muestras individuales.`,
  /* hist.defrost_total */ (d) => `Desescarche · ${d}`,
  /* hist.defrost_none */ "No se observó ningún ciclo de desescarche en el periodo registrado.",
  /* hist.defrost_active */ "Desescarche",
  /* hist.defrost_inactive */ "Sin desescarche",
  /* hist.defrost_aria */ (l, d) => `${l} — cronología de desescarche. ${d}. Las flechas permiten leer muestras individuales.`,
  /* hist.quiet_total */ (d) => `Silencioso · ${d}`,
  /* hist.quiet_none */ "No se observó ningún intervalo de modo silencioso en el periodo registrado.",
  /* hist.quiet_active */ "Silencioso activo",
  /* hist.quiet_inactive */ "Silencioso inactivo",
  /* hist.quiet_aria */ (l, d) => `${l} — cronología del modo silencioso. ${d}. Las flechas permiten leer muestras individuales.`,
  /* hist.heater_total */ (d) => `Resistencia · ${d}`,
  /* hist.heater_none */ "No se observó ningún uso del calentador del depósito en el periodo registrado.",
  /* hist.heater_active */ "Resistencia activa",
  /* hist.heater_inactive */ "Resistencia inactiva",
  /* hist.heater_aria */ (l, d) => `${l} — cronología del calentador del depósito. ${d}. Las flechas permiten leer muestras individuales.`,
  /* hist.preheat_total */ (d) => `Precalentamiento · ${d}`,
  /* hist.preheat_none */ "No se observó ningún intervalo de precalentamiento del depósito en el periodo registrado.",
  /* hist.preheat_active */ "Precalentando",
  /* hist.preheat_inactive */ "Sin precalentar",
  /* hist.preheat_aria */ (l, d) => `${l} — cronología X10A del precalentamiento del depósito. ${d}. Las flechas permiten leer muestras individuales.`,
  /* hist.disinfection_total */ (d) => `Desinfección · ${d}`,
  /* hist.disinfection_none */ "No se observó ninguna operación de desinfección en el periodo registrado.",
  /* hist.disinfection_active */ "Desinfección activa",
  /* hist.disinfection_inactive */ "Desinfección inactiva",
  /* hist.disinfection_aria */ (l, d) => `${l} — cronología de desinfección de HomeHub. ${d}. Las flechas permiten leer muestras individuales.`,
  /* hist.buh_total */ (d) => `Auxiliar · ${d}`,
  /* hist.buh_none */ "No se observó ningún uso del calentador auxiliar en el periodo registrado.",
  /* hist.buh_active */ "Auxiliar activo",
  /* hist.buh_inactive */ "Auxiliar inactivo",
  /* hist.buh_step1 */ "Etapa 1",
  /* hist.buh_step2 */ "Etapa 2",
  /* hist.buh_aria */ (l, d) => `${l} — cronología del calentador auxiliar. ${d}. Las flechas permiten leer muestras individuales.`,
  /* hist.valve_dhw_total */ (d) => `ACS · ${d}`,
  /* hist.valve_space_total */ (d) => `Climatización · ${d}`,
  /* hist.valve_none */ "Ninguna posición de ACS en el periodo registrado.",
  /* hist.valve_dhw */ "ACS",
  /* hist.valve_space */ "Climatización",
  /* hist.valve_aria */ (l, d) => `${l} — cronología de la válvula de 3 vías. ${d}. Las flechas permiten leer muestras individuales.`,
  /* hist.circ_total */ (d) => `Bomba · ${d}`,
  /* hist.circ_none */ "No se observó ningún funcionamiento de la bomba en el periodo registrado.",
  /* hist.circ_on */ "En marcha",
  /* hist.circ_off */ "Parada",
  /* hist.circ_unavailable */ "No disponible",
  /* hist.circ_gaps */ (n) => `${n} ${n === 1 ? "intervalo no disponible" : "intervalos no disponibles"}`,
  /* hist.circ_aria */ (l, d) => `${l} — cronología de la bomba de circulación. ${d}. Las flechas permiten leer muestras individuales.`,
  /* hist.valve2_on_total */ (d) => `2WV activa · ${d}`,
  /* hist.valve2_off_total */ (d) => `2WV inactiva · ${d}`,
  /* hist.valve2_on */ "2WV activa",
  /* hist.valve2_off */ "2WV inactiva",
  /* hist.valve2_none */ "No se registró ningún estado activo para la salida de la válvula de 2 vías en el periodo seleccionado.",
  /* hist.valve2_aria */ (l, d) => `${l} — cronología de la salida de la válvula de 2 vías. ${d}. Las flechas permiten leer muestras individuales.`,
  /* hist.flow_switch_total */ (d) => `Flujostato activo · ${d}`,
  /* hist.flow_switch_on */ "Flujostato activo",
  /* hist.flow_switch_off */ "Flujostato inactivo",
  /* hist.flow_switch_none */ "No se registró ningún estado activo para esta señal X10A en el periodo seleccionado.",
  /* hist.flow_switch_aria */ (l, d) => `${l} — cronología del interruptor de caudal de agua. ${d}. Las flechas permiten leer muestras individuales.`,
  /* toast.saved */ "Guardado",
  /* toast.no_changes */ "Sin cambios",
  /* toast.reboot */ "Reiniciando — volviendo a conectar…",
  /* toast.rebooted */ "Reiniciado — vuelve a conectarte al dispositivo",
  /* toast.busy_retry */ "Dispositivo ocupado — vuelve a intentarlo en un momento",
  /* toast.unreachable */ "No se pudo acceder al dispositivo",
  /* toast.rejected */ "Rechazado",
  /* toast.applying */ "Aún se está aplicando el último cambio…",
  /* toast.check_wifi */ "Comprueba los ajustes de WiFi",
  /* toast.check_broker */ "Comprueba la dirección del bróker",
  /* toast.check_syslog_port */ "Comprueba el puerto de Syslog",
  /* toast.verifying_mqtt */ "Verificando la conexión MQTT…",
  /* toast.saving_syslog */ "Guardando los ajustes de Syslog…",
  /* toast.saving_ntp */ "Guardando los ajustes de NTP…",
  /* toast.trying_pins */ "Probando pines…",
  /* toast.saving_board */ "Guardando el hardware de la placa…",
  /* ota.uptodate */ "actualizado",
  /* ota.check_failed */ "comprobación fallida",
  /* ota.starting */ "iniciando…",
  /* ota.pct */ (p) => `${p}%`,
  /* ota.rebooting */ "reiniciando…",
  /* ota.failed */ "actualización fallida",
  /* ota.timeout */ "tiempo agotado",
  /* ota.cancelled */ "cancelada",
  /* ota.busy */ "dispositivo ocupado",
  /* ota.replaced */ "La operación de actualización cambió — compruébala de nuevo",
  /* ota.unreachable */ "dispositivo no accesible",
  /* ota.active_title */ "Actualización de firmware",
  /* ota.active_sub */ (detail) => `Instalación en curso · ${detail}`,
  /* ota.active_sub_cached */ (detail) => `Instalación en curso · ${detail} · último estado recibido`,
  /* ota.snapshot_title */ "Actualización de firmware",
  /* ota.snapshot_label */ "Estado de los datos",
  /* ota.snapshot_value */ "Instantánea",
  /* ota.snapshot_help */ "Último estado recibido antes de esta recarga. Los datos en directo pueden pausarse durante la instalación; los ajustes permanecen bloqueados hasta el reinicio.",
  /* ota.reload_hint */ "instalada — recarga la página",
  /* ota.dialog_title */ "Actualización de firmware",
  /* ota.switch_title */ "Cambiar la versión de firmware",
  /* ota.changes_title */ "Novedades de esta compilación",
  /* ota.no_changes */ "No se proporcionó un registro de cambios para esta compilación.",
  /* ota.install_help */ "El dispositivo descarga e instala la imagen firmada y después se reinicia. Si el nuevo firmware no consigue conectarse, el dispositivo restaura automáticamente la compilación actual.",
  /* ota.switch_help */ "Esta compilación es anterior porque se ha seleccionado otro canal de actualización. Su firma se verifica antes de instalarla. Si no consigue conectarse, el dispositivo restaura automáticamente la compilación actual.",
  /* ota.install */ "Instalar actualización",
  /* ota.switch */ "Instalar compilación anterior",
  /* aria.ota */ "Buscar actualizaciones de firmware",
  /* ota.title_check */ "Toca para buscar actualizaciones de firmware",
  /* ota.title_avail */ (v) => `Actualización v${v} disponible — toca para instalar`,
  /* mq.err_format */ "Introduce host:puerto; p. ej., 192.168.1.10:1883, o mqtts://host:8883 para TLS",
  /* sl.err_port */ "El puerto debe ser un número entero entre 1 y 65535 (p. ej., logs.example.com:514).",
  /* btn.saving */ "Guardando…",
  /* btn.verifying */ "Verificando…",
  /* btn.save */ "Guardar",
  /* btn.cancel */ "Cancelar",
  /* btn.close */ "Cerrar",
  /* schem.card_aria */ "Esquema en vivo del sistema: unidad exterior, circuito frigorífico, intercambiador de placas, circuito de agua con calentador auxiliar y válvula de 3 vías, depósito ACS y circuito de climatización",
  /* schem.group_aria */ "Esquema en vivo — selecciona un valor o componente para ver su explicación",
  /* schem.outdoor_unit */ "UNIDAD EXTERIOR",
  /* schem.defrost_pill */ "❄ desescarche",
  /* schem.outdoor */ "Exterior",
  /* insp.close */ "Cerrar",
  /* schem.leaving_water */ "R1T",
  /* schem.dhw_tank */ "DEPÓSITO ACS",
  /* schem.set */ "consigna",
  /* schem.bsh_label */ "Resistencia",
  /* schem.space_circuit */ "CLIMATIZACIÓN",
  /* schem.heating */ "CALEFACCIÓN",
  /* schem.cooling */ "REFRIGERACIÓN",
  /* schem.pump */ "BOMBA",
  /* schem.return */ "R4T",
  /* schem.room */ "Estancia",
  /* schem.flow_rate */ "caudal",
  /* schem.water_press */ "presión",
  /* schem.r2t */ "R2T",
  /* schem.r3t */ "R3T",
  /* schem.flow_switch */ "FLUJOSTATO",
  /* schem.valve2 */ "2WV",
  /* wifi.title */ "Configuración WiFi",
  /* wifi.ssid */ "Red WiFi (SSID)",
  /* wifi.pass */ "Contraseña WiFi",
  /* wifi.err_ssid */ "El SSID debe tener 32 caracteres o menos",
  /* wifi.err_pass */ "La contraseña debe estar vacía (red abierta) o tener entre 8 y 63 caracteres",
  /* wifi.hint */ "Introduce el nombre de la red WiFi. Si el dispositivo no puede conectarse, restaura automáticamente los ajustes WiFi anteriores.",
  /* mqtt.title */ "Bróker MQTT",
  /* mqtt.hostport */ "Host : puerto",
  /* mqtt.user */ "Usuario · opcional",
  /* mqtt.pass */ "Contraseña · opcional",
  /* mqtt.clear */ "Eliminar las credenciales guardadas — conectar de forma anónima",
  /* mqtt.hint */ "Un usuario o una contraseña requieren una conexión TLS cifrada (mqtts://, por ejemplo mqtts://host:8883). Deja el host vacío para desactivar MQTT.",
  /* mqtt.base */ "Tema base",
  /* mqtt.base_hint */ "Un tema base por dispositivo. Una segunda placa en este bróker necesita el suyo propio; de lo contrario, ambas comparten sus temas, métricas y dispositivo de Home Assistant. Al cambiarlo se renombra esta instalación en Home Assistant y los antiguos temas retenidos permanecen en el bróker.",
  /* err.mqtt_base_too_long */ "El tema base es demasiado largo.",
  /* err.mqtt_base_wildcard */ "Un tema base no puede contener + ni #: son comodines de suscripción y el bróker se niega a publicar en ellos.",
  /* err.mqtt_base_reserved */ "Un tema base no puede empezar por $: ese árbol pertenece al propio bróker.",
  /* err.mqtt_base_slash */ "Un tema base no puede empezar ni terminar con una barra.",
  /* err.mqtt_base_control */ "Un tema base no puede contener caracteres de control.",
  /* err.mqtt_base_space */ "Un tema base no puede contener espacios.",
  /* err.mqtt_base_empty_segment */ "Un tema base no puede contener un segmento vacío (//).",
  /* err.mqtt_base_not_sluggable */ "Un tema base necesita al menos una letra o un dígito: se convierte en el ID de dispositivo de esta instalación en Home Assistant y, sin él, dos dispositivos colisionarían.",
  /* mqtt.err.waiting_x10a */ "Aún no hay respuesta de la bomba de calor en X10A: comprueba el cableado, GND y los pines RX/TX.",
  /* mqtt.err.task_alloc */ "No se pudo iniciar la tarea MQTT: reinicia el dispositivo y comprueba el diagnóstico.",
  /* mqtt.err.transport */ "Falló la conexión TLS/TCP con el bróker.",
  /* mqtt.err.refused */ "El bróker rechazó la conexión: comprueba el usuario y la contraseña.",
  /* mqtt.err.connection */ "Falló la conexión con el bróker MQTT.",
  /* dyn.card */ "Diagnóstico de la curva de calefacción",
  /* dyn.state */ "Estado",
  /* dyn.state_recording */ "Registrando",
  /* dyn.state_recording_nowx */ "Registrando · sin previsión",
  /* dyn.state_waiting */ "Esperando calefacción de espacios",
  /* dyn.state_cooling */ "Refrigeración · sin muestreo",
  /* dyn.state_room */ "Fuente de habitación no utilizable",
  /* dyn.state_x10a */ "X10A sin conexión",
  /* dyn.state_homehub */ "HomeHub sin conexión",
  /* dyn.state_gate */ "Estado de la instalación desconocido",
  /* dyn.state_mode */ "Modo de calefacción/refrigeración desconocido",
  /* dyn.state_clock */ "Reloj sin ajustar",
  /* dyn.state_blocked */ "Sin registrar",
  /* dyn.state_setup_room */ "Configura una fuente de habitación",
  /* dyn.state_setup_homehub */ "HomeHub sin configurar",
  /* dyn.state_homehub_disabled */ "Diagnóstico apagado — HomeHub desactivado",
  /* dyn.state_no_broker */ "Sin registrar — no hay bróker MQTT",
  /* dyn.state_safe_mode */ "Sin registrar — modo seguro",
  /* dyn.state_inactive */ "Sin registrar — muestreador detenido",
  /* dyn.room_off */ "Termostato de habitación apagado",
  /* dyn.room_not_heating */ "El termostato de habitación no está en calefacción",
  /* dyn.room_stale */ "Lectura de habitación demasiado antigua",
  /* dyn.room_no_value */ "Esperando una lectura de habitación",
  /* dyn.room_invalid_payload */ "Mensaje MQTT no válido",
  /* dyn.room_invalid_temperature */ "Temperatura de habitación fuera del intervalo permitido",
  /* dyn.room_invalid_setpoint */ "Temperatura objetivo fuera del intervalo permitido",
  /* dyn.room_no_setpoint */ "Falta la temperatura objetivo",
  /* dyn.room_no_time */ "Falta la hora de medición",
  /* dyn.room_retained_no_time */ "Valor retenido sin hora de medición",
  /* dyn.room_future_time */ "La hora de medición está en el futuro",
  /* dyn.room_backward_time */ "La hora de medición retrocedió",
  /* dyn.room_invalid_time */ "Hora de medición no válida",
  /* dyn.room_no_enabled */ "Falta el estado encendido/apagado del termostato",
  /* dyn.room_no_hvac_mode */ "Falta el modo de funcionamiento del termostato",
  /* dyn.room_source */ "Fuente de temperatura ambiente",
  /* dyn.weather */ "Previsión comparativa opcional",
  /* dyn.strategy */ "Señal de diagnóstico",
  /* dyn.not_configured */ "Sin configurar",
  /* dyn.outdoor */ "Aire exterior medido",
  /* dyn.outdoor_detail_status */ "Estado",
  /* dyn.outdoor_detail_now */ "Lectura actual",
  /* dyn.outdoor_detail_sample */ "En el último evento registrado",
  /* dyn.outdoor_status_live */ (source) => `${source} tiene una lectura actual; se adjunta a cada evento registrado como contexto.`,
  /* dyn.outdoor_status_unavailable */ (source) => `${source} está configurado, pero no tiene ninguna lectura actual. Los eventos continúan sin este eje.`,
  /* dyn.outdoor_status_absent */ (source) => `${source} no está configurado. Los eventos continúan sin este eje.`,
  /* dyn.outdoor_status_idle */ (source) => `${source} está configurado, pero ahora no se registra nada. La fila de estado de arriba indica el motivo.`,
  /* dyn.outdoor_sample_none */ "Registrado sin valor exterior",
  /* dyn.outdoor_help_axis */ "La temperatura exterior permite interpretar una desviación ambiente registrada. Sin ella, +0,5 K a −5 °C y +0,5 K a +12 °C parecen iguales, aunque uno apunta a una curva demasiado pronunciada y el otro a una curva ajustada demasiado alta. Es opcional: el registro continúa sin ella y el valor nunca se utiliza para decidir si se registra un evento.",
  /* dyn.outdoor_help_placement */ "Este valor corresponde a lo que mida el sensor donde esté montado. El firmware no puede saber dónde está: junto a la unidad interior mide el aire de la habitación; en una ubicación exterior sombreada mide el aire exterior real, y solo esto último hace que la comparación sea significativa.",
  /* dyn.outdoor_help_setup */ "Un M5Stack ENV III conectado al puerto Grove de la placa puede proporcionarlo. Montado en el exterior y a la sombra, mide continuamente el aire exterior, a diferencia del sensor propio de la bomba de calor, que deja de actualizarse mientras la unidad exterior está en reposo. Se configura en ESP32 → Hardware, junto con la placa a la que se conecta.",
  /* dyn.plant_outdoor */ "Aire exterior de la instalación",
  /* dyn.plant_outdoor_help */ "Es la entrada 44 de HomeHub, el concepto de aire exterior propio de la bomba de calor. Se captura en el mismo ciclo Modbus actual que las condiciones de las ventanas de calefacción y su fuente se guarda con el evento. Permanece separado de ENV III y nunca cambia si se registra o no un evento.",
  /* dyn.shadow_strategy */ "Desviación ambiente bruta · 30 min",
  /* dyn.card_help */ "Cada 30 minutos durante una calefacción de espacios claramente identificada, el firmware registra cuánto se desvía la temperatura de la habitación de referencia de su objetivo, junto con la temperatura exterior de ese momento cuando la proporciona un sensor. Junto con el tiempo de funcionamiento, los límites mínimos de temperatura del agua de impulsión y la actividad del termostato, el patrón a largo plazo puede mostrar si la curva de calefacción tiende a ser demasiado alta o baja. Una desviación ambiente de 1 K no implica automáticamente un cambio de 1 K en el agua de impulsión. Esta función solo lee datos y no escribe nada en la bomba de calor.",
  /* dyn.state_help_recording */ "La calefacción de espacios confirmada está funcionando y la entrada de habitación es válida, por lo que se registran muestras brutas del error ambiente. Interpreta una tendencia estacional junto con el tiempo de funcionamiento y las pruebas de recorte; una sola muestra no es un veredicto.",
  /* dyn.state_help_waiting */ "La instalación no está ahora en funcionamiento normal de climatización, por lo que no se registra ninguna muestra. Durante el verano es el estado normal y esperado, no un fallo.",
  /* dyn.state_help_cooling */ "HomeHub informa de funcionamiento normal de climatización, pero el modo actual es refrigeración. Las ventanas de refrigeración se excluyen deliberadamente del conjunto de datos de la curva de calefacción.",
  /* dyn.state_help_blocked */ "Falta una entrada necesaria, por lo que no se registra nada. El registro se reanuda cuando vuelve; nunca se muestrean pruebas antiguas o ambiguas.",
  /* dyn.state_help_room */ "La lectura de habitación llega al dispositivo, pero ahora no puede proporcionar una desviación válida respecto al objetivo. No se genera ninguna muestra hasta que la fuente vuelva a ser utilizable.",
  /* dyn.state_help_setup */ "El diagnóstico comienza cuando se guarda una fuente MQTT de habitación con marca temporal y un objetivo. La previsión es una prueba comparativa opcional; no es necesario revelar la ubicación.",
  /* dyn.state_help_inactive */ "Las fuentes están configuradas, pero nada las evalúa: el muestreador se ejecuta en la conexión MQTT y esta placa arrancó en modo seguro tras varios arranques con fallo, donde todo consumidor opcional se mantiene inactivo. No se pierde nada: el registro se reanuda solo cuando la placa vuelve a arrancar normalmente.",
  /* dyn.state_help_no_broker */ "Hay una fuente de habitación guardada, pero el diagnóstico la lee mediante MQTT y no hay ningún bróker configurado. Configura el bróker en la tarjeta Conexiones; se conserva la fuente guardada y el registro comienza por sí solo.",
  /* dyn.state_help_setup_homehub */ "El diagnóstico necesita que HomeHub indique cuándo la instalación está calentando realmente; sin él no puede distinguir una ventana de calefacción del agua caliente o una parada. Configura la dirección de HomeHub en la tarjeta Protocolo.",
  /* dyn.state_help_homehub_disabled */ "Este diagnóstico depende de dos señales de la instalación de HomeHub. Si la dirección de HomeHub está explícitamente vacía, no se ejecutan ni Modbus ni este diagnóstico dependiente.",
  /* dyn.strategy_help */ "La muestra es la temperatura objetivo de la habitación menos la temperatura real: un valor positivo significa que la habitación está por debajo del objetivo; uno negativo, que está por encima. No hay banda muerta, redondeo, limitación ni límite de velocidad. Es un indicador sin calibrar, no una corrección solicitada del agua de impulsión. La habitación de referencia debe representar la zona climatizada. Su propio termostato o unas válvulas cerradas forman un bucle de control interno: pueden eliminar la demanda de calor y ocultar una curva demasiado alta. Interpreta la tendencia ambiente junto con la frecuencia con la que la temperatura del agua de impulsión se mantiene en su mínimo (porcentaje de recorte D2) y la frecuencia con la que la zona solicita calor realmente.",
  /* env.title */ "Sensor exterior",
  /* env.card */ "Clima exterior",
  /* env.none */ "Sin sensor",
  /* env.temperature */ "Temperatura",
  /* env.humidity */ "Humedad",
  /* env.pressure */ "Presión atmosférica",
  /* env.sensor_state */ "Sensor",
  /* env.live */ "En directo",
  /* env.collecting */ "Recopilando…",
  /* env.history_title */ "Mediciones de ENV III",
  /* env.history_help */ "La temperatura, la humedad y la presión atmosférica se conservan en el ESP32 como tendencias móviles de 24 horas a intervalos de cinco minutos.",
  /* env.history_scales */ "escalas individuales",
  /* env.unavailable */ "Sensor no disponible",
  /* env.err_pins */ "SDA y SCL deben ser pines válidos distintos",
  /* env.saving */ "Guardando la configuración del sensor exterior…",
  /* env.checking */ "Comprobando ENV III…",
  /* env.err_not_reachable */ "ENV III no está accesible actualmente en estos pines SDA/SCL.",
  /* env.err_sht30 */ "El sensor de temperatura/humedad de ENV III no está accesible en estos pines.",
  /* env.err_qmp6988 */ "El sensor de presión de ENV III no está accesible en estos pines.",
  /* env.err_disable_first */ "Selecciona Sin sensor y guarda antes de cambiar los pines SDA/SCL.",
  /* env.pins_hint */ "SDA = datos (cable Grove amarillo); SCL = reloj (cable Grove blanco). Si los dos GPIO seleccionados están invertidos, el firmware comprueba el orden contrario y guarda automáticamente la asignación que funciona.",
  /* env.atoms3_header_hint */ "AtomS3 Lite: usa dos de los pines ofrecidos; el conector de la carcasa lleva GPIO5–GPIO8 y GPIO38. El puerto Grove (GPIO2/1) solo aparece cuando la conexión X10A no lo usa: un mismo contacto no puede llevar tanto la conexión serie como el bus I2C. GPIO39 no está disponible para ENV III.",
  /* ref.title */ "Fuente de temperatura ambiente",
  /* ref.name */ "Nombre",
  /* ref.temperature_source */ "Fuente de temperatura",
  /* ref.target */ "Temperatura objetivo",
  /* ref.timestamp_source */ "Fuente de marca temporal · opcional",
  /* ref.max_age */ "Antigüedad máxima · segundos",
  /* ref.temperature_source_help */ "Tema MQTT exacto y ruta JSON opcional después de $. Las rutas ausentes o incorrectas se notifican cuando llega un mensaje.",
  /* ref.target_help */ "Un valor fijo en °C o un tema MQTT exacto con una ruta JSON opcional después de $.",
  /* ref.timestamp_source_help */ "Hora de origen RFC3339/Unix opcional como tema$ruta. Si se deja vacío, se usa la hora de llegada MQTT en directo; los valores retenidos se rechazan entonces por seguridad.",
  /* ref.max_age_help */ "Antigüedad máxima permitida de la lectura de origen, de 10 a 3600 segundos.",
  /* ref.error */ "Último error",
  /* ref.broker_off */ "Bróker MQTT desactivado",
  /* ref.retained */ "almacenado en caché por el bróker",
  /* ref.time_untrusted */ "Valor retenido sin hora de medición fiable",
  /* ref.clock_unsynced */ "Reloj del dispositivo sin sincronizar",
  /* ref.now */ "ahora",
  /* ref.ago */ (s) => `hace ${s} s`,
  /* ref.age_unknown */ "desconocida",
  /* ref.saved */ "Fuente de temperatura ambiente guardada",
  /* ref.detail.status_label */ "Estado:",
  /* ref.detail.diagnosis_label */ "Diagnóstico de la curva de calefacción:",
  /* ref.status.measurement_valid */ "Medición válida",
  /* ref.status.not_configured */ "Sin configurar",
  /* ref.status.usable */ "Utilizable",
  /* ref.status.unusable */ "No utilizable",
  /* ref.status.error */ "Error",
  /* ref.status.stale */ "Antigua",
  /* ref.status.waiting */ "Esperando",
  /* ref.status.unavailable */ "No disponible",
  /* ref.detail.setup */ "Añade una fuente MQTT con el lápiz",
  /* ref.detail.stale */ "La lectura es más antigua de lo permitido",
  /* ref.detail.waiting */ "Aún no se ha recibido ninguna lectura MQTT",
  /* ref.detail.error */ (e) => `Mensaje MQTT rechazado: ${e}`,
  /* ref.detail.temperature_label */ "Temperatura ambiente:",
  /* ref.detail.temperature */ (v) => `${v} °C`,
  /* ref.detail.setpoint_label */ "Temperatura objetivo:",
  /* ref.detail.setpoint */ (v) => `${v} °C`,
  /* ref.detail.last_measurement_label */ "Lectura más reciente:",
  /* ref.detail.last_measurement */ (v) => v,
  /* ref.detail.last_measurement_stale */ (v, max) => `${v} · permitido: como máximo ${max} s`,
  /* ref.detail.purpose */ "El diagnóstico compara la temperatura ambiente con la objetivo para mostrar con el tiempo si la curva de calefacción es demasiado alta o baja. No se controla la bomba de calor.",
  /* ref.delete */ "Eliminar",
  /* ref.deleting */ "Eliminando…",
  /* ref.deleted */ "Fuente de temperatura ambiente y lectura capturada eliminadas",
  /* circ.title */ "Fuente de la bomba de circulación",
  /* circ.row */ "Bomba de circulación de ACS",
  /* circ.default_name */ "Bomba de circulación",
  /* circ.name */ "Nombre",
  /* circ.topic */ "Tema MQTT",
  /* circ.power_path */ "Ruta JSON de potencia",
  /* circ.time_path */ "Ruta JSON de marca temporal",
  /* circ.power_help */ "Potencia activa real en vatios; no se utiliza la salida del relé.",
  /* circ.time_help */ "Hora de medición en RFC3339 o segundos Unix.",
  /* circ.on_threshold */ "Activar desde · W",
  /* circ.off_threshold */ "Desactivar hasta · W",
  /* circ.max_age */ "Antigüedad máxima · segundos",
  /* circ.confirm */ "Confirmación · segundos",
  /* circ.hint */ "Solo lectura. Al guardar, primero se comprueba un valor MQTT reciente y nunca se conmuta el enchufe.",
  /* circ.settings_help */ "La placa correlaciona la potencia real de la bomba con ventanas limpias de enfriamiento del depósito de una hora. Solo observa y nunca conmuta el enchufe.",
  /* circ.not_configured */ "Sin configurar",
  /* circ.unavailable */ "No disponible",
  /* circ.broker_off */ "Sin bróker MQTT",
  /* circ.running */ "En marcha",
  /* circ.stopped */ "Parada",
  /* circ.checking */ "Comprobando",
  /* circ.stale */ "Antigua",
  /* circ.waiting */ "Esperando un mensaje",
  /* circ.detail.source */ "Fuente",
  /* circ.detail.power */ "Potencia activa",
  /* circ.detail.state */ "Estado detectado",
  /* circ.detail.age */ "Antigüedad de la medición",
  /* circ.delete */ "Eliminar",
  /* circ.deleting */ "Eliminando…",
  /* circ.deleted */ "Fuente de la bomba de circulación eliminada",
  /* circ.saved */ "Fuente de la bomba de circulación guardada",
  /* circ.test_failed */ "No se recibió ningún valor de potencia de la bomba reciente y legible",
  /* circ.err_topic */ "Introduce un tema MQTT exacto sin los comodines + ni #",
  /* circ.err_power_path */ "Introduce la ruta JSON de potencia activa, por ejemplo apower",
  /* circ.err_time_path */ "Introduce la ruta JSON de marca temporal, por ejemplo aenergy.minute_ts",
  /* circ.err_max_age */ "La antigüedad máxima debe ser un número entero entre 10 y 3600 segundos",
  /* circ.err_confirm */ "La confirmación debe ser un número entero entre 1 y 600 segundos",
  /* circ.err_threshold */ "Los umbrales de potencia deben tener como máximo un decimal",
  /* circ.err_order */ "El umbral de activación debe ser mayor que el de desactivación",
  /* wx.title */ "Previsión meteorológica de Open-Meteo",
  /* wx.latitude */ "Latitud",
  /* wx.longitude */ "Longitud",
  /* wx.waiting */ "Esperando la previsión",
  /* wx.fetching */ "Obteniendo la previsión de Open-Meteo…",
  /* wx.unavailable */ "No disponible",
  /* wx.error */ "Error de previsión de Open-Meteo",
  /* wx.detail.status */ "Estado:",
  /* wx.status.fresh */ "Actual",
  /* wx.status.inactive */ "Apagada",
  /* wx.status.fetching */ "Actualizando",
  /* wx.status.stale */ "Antigua",
  /* wx.status.unavailable */ "No disponible",
  /* wx.status.waiting */ "Esperando",
  /* wx.detail.fresh */ "La previsión se obtuvo correctamente.",
  /* wx.detail.fetching */ "El ESP32 está obteniendo nuevos datos de previsión.",
  /* wx.detail.stale */ "La última obtención correcta es demasiado antigua; los valores se muestran solo para el diagnóstico.",
  /* wx.detail.unavailable */ "La última obtención falló; si existe un valor anterior, se muestra solo para el diagnóstico.",
  /* wx.detail.waiting */ "Aún no se ha recibido ninguna previsión.",
  /* wx.detail.temperature_label */ "Temperatura:",
  /* wx.detail.temperature */ (v) => `${v} °C es la temperatura media prevista del aire exterior para las dos próximas horas completas.`,
  /* wx.detail.solar_label */ "Irradiación solar:",
  /* wx.detail.solar */ (v) => `${v} Wh/m² es la irradiación horizontal global prevista durante el mismo periodo de dos horas.`,
  /* wx.detail.source_label */ "Fuente:",
  /* wx.detail.source */ "Open-Meteo · DWD ICON Seamless. Solo observación; la previsión no cambia el control de la bomba de calor.",
  /* wx.err_both */ "Introduce tanto la latitud como la longitud o deja ambas vacías para desactivar",
  /* wx.err_latitude */ "La latitud debe ser un número decimal entre -90 y 90",
  /* wx.err_longitude */ "La longitud debe ser un número decimal entre -180 y 180",
  /* wx.saving */ "Guardando la fuente meteorológica…",
  /* wx.hint.configured */ "El ESP32 solicita una nueva previsión cada 45 minutos. Cada solicitud envía las coordenadas a Open-Meteo y revela la dirección IP pública de la conexión. Deja vacíos ambos campos de coordenadas para eliminar la fuente.",
  /* wx.hint.setup */ "Introduce la latitud y la longitud. Puedes pegar en cualquiera de los campos un par de coordenadas copiado de Google Maps y se separará automáticamente. Tras guardarlo, el ESP32 solicita una nueva previsión cada 45 minutos. Cada solicitud envía las coordenadas a Open-Meteo y revela la dirección IP pública de la conexión. La previsión es solo de observación y no cambia el control de la bomba de calor.",
  /* wx.attribution */ "Datos meteorológicos de Open-Meteo.com · DWD ICON Seamless",
  /* ref.err_temperature_source */ "Introduce un tema MQTT exacto, seguido opcionalmente de $ruta-json",
  /* ref.err_target */ "Introduce un valor fijo de 5 a 35 °C o un tema MQTT exacto, seguido opcionalmente de $ruta-json",
  /* ref.err_timestamp_source */ "Introduce un tema MQTT exacto, seguido opcionalmente de $ruta-json",
  /* ref.err_max_age */ "La antigüedad máxima debe ser un número entero entre 10 y 3600 segundos",
  /* ref.save_help */ "Guardar almacena la asignación. Se suscribe mientras está activado el diagnóstico de la instalación; de lo contrario, permanece inactiva. Sigue siendo necesario un valor MQTT legible y reciente.",
  /* syslog.title */ "Servidor Syslog",
  /* syslog.hostport */ "Host : puerto",
  /* syslog.hint */ "Introduce el servidor Syslog como nombre de host o dirección IP más el puerto. Deja el campo vacío para desactivar Syslog.",
  /* ntp.title */ "Servidor NTP",
  /* ntp.server */ "Servidor",
  /* ntp.hint */ "Introduce el nombre de host o la dirección IP del servidor horario. Deja el campo vacío para usar el valor predeterminado del firmware.",
  /* homehub.title */ "Modbus",
  /* homehub.host */ "Host · IP o nombre .local",
  /* homehub.port */ "Puerto",
  /* homehub.unit */ "ID de unidad",
  /* homehub.hint */ "Un firmware nuevo busca automáticamente una vez en su primer arranque con red y guarda el resultado. También puedes ejecutar la búsqueda manualmente aquí. Guarda el resultado o introduce una dirección manualmente. Guardar una dirección vacía desactiva HomeHub permanentemente: no habrá futuras búsquedas automáticas, solicitudes Modbus ni diagnósticos dependientes. El puerto predeterminado es 502 y el ID de unidad, 1. Este diálogo solo configura la fuente de datos; no ofrece ningún control de la bomba de calor.",
  /* hh.search */ "Buscar",
  /* hh.searching */ "Buscando…",
  /* hh.found */ (host) => `HomeHub encontrado: ${host}`,
  /* hh.not_found */ "No se encontró ningún HomeHub — introduce la dirección manualmente.",
  /* hh.saved */ "Ajustes de Modbus guardados",
  /* hh.err_port */ "El puerto debe estar entre 1 y 65535",
  /* hh.err_unit */ "El ID de unidad debe estar entre 1 y 247",
  /* board.title */ "Hardware de la placa",
  /* board.ledtype */ "LED de estado",
  /* board.none */ "Ninguno",
  /* board.reset_section */ "Botón de reinicio",
  /* board.env3_section */ "ENV III · Sensor exterior",
  /* board.preset */ "Placa",
  /* board.preset_custom */ "Personalizada",
  /* board.not_selected */ "Sin seleccionar",
  /* board.led_gpio */ "LED simple (GPIO)",
  /* board.led_ws2812 */ "RGB direccionable (WS2812)",
  /* board.ledpin */ "Pin del LED",
  /* board.btnpin */ "Pin del botón de reinicio",
  /* board.ledlegend_rgb */ "Colores del LED y patrones de parpadeo",
  /* board.ledlegend_gpio */ "Patrones de parpadeo del LED",
  /* board.led_rgb_off */ "Apagado — no hay ningún modo Wi-Fi activo.",
  /* board.led_rgb_setup */ "Azul, parpadeo lento — portal de configuración activo.",
  /* board.led_rgb_connecting */ "Amarillo, parpadeo rápido — conectando a Wi-Fi.",
  /* board.led_rgb_healthy */ "Verde fijo — todas las conexiones configuradas están listas.",
  /* board.led_rgb_bus_down */ "Rojo, doble destello — X10A desconectado.",
  /* board.led_rgb_mqtt_down */ "Naranja, parpadeando — X10A conectado, MQTT desconectado.",
  /* board.led_rgb_wipe_armed */ "Rojo, parpadeo muy rápido — borrado preparado; suelta para cancelar.",
  /* board.led_rgb_wiping */ "Blanco fijo — restablecimiento/borrado en curso; no desconectes la alimentación.",
  /* board.led_gpio_off */ "Apagado — no hay ningún modo Wi-Fi activo.",
  /* board.led_gpio_setup */ "Parpadeo lento — portal de configuración activo.",
  /* board.led_gpio_connecting */ "Parpadeo rápido — conectando a Wi-Fi.",
  /* board.led_gpio_healthy */ "Fijo — todas las conexiones configuradas están listas.",
  /* board.led_gpio_bus_down */ "Doble destello — X10A desconectado.",
  /* board.led_gpio_mqtt_down */ "Parpadeo a velocidad media — X10A conectado, MQTT desconectado.",
  /* board.led_gpio_wipe_armed */ "Parpadeo muy rápido — borrado preparado; suelta para cancelar.",
  /* board.led_gpio_wiping */ "Fijo tras parpadeo muy rápido — restablecimiento/borrado en curso; no desconectes la alimentación.",
  /* board.ledinv */ "Activo en nivel bajo (el LED se enciende cuando el pin está en LOW)",
  /* board.btninv */ "Activo en nivel bajo (el botón conecta el pin a GND)",
  /* board.hint */ "Restablecimiento de fábrica: mantén pulsado 5 s. Borra permanentemente Wi-Fi/todos los ajustes, historial/tendencias, duraciones de estado y volcado de memoria sin procesar. El portal solo se abre si todo se borra correctamente. Si no, suelta y mantén otros 5 s. Elige «Ninguno» sin botón.",
  /* card.hardware */ "Hardware",
  /* card.hw_off */ "Ninguno",
  /* card.hw_led */ (pin, kind) => `GPIO${pin} · ${kind}`,
  /* card.hw_btn */ (pin) => `GPIO${pin}`,
  /* card.hw_board_m5stack */ "M5Stack AtomS3 Lite es una placa ESP32-S3 compacta con un LED de estado RGB WS2812 integrado.",
  /* card.hw_board_seeed */ "Seeed XIAO ESP32-S3 es una placa ESP32-S3 compacta de Seeed Studio.",
  /* card.hw_board_other */ (name) => `Placa seleccionada: ${name}.`,
  /* card.hw_active_low */ "activo en LOW",
  /* card.hw_active_high */ "activo en HIGH",
  /* card.hw_led_detail */ (kind, pin, active) => `${kind} en GPIO${pin}${active ? `, ${active}` : ""}.`,
  /* card.hw_led_disabled */ "Sin configurar.",
  /* card.hw_btn_detail */ (pin, active) => `GPIO${pin}, ${active}.`,
  /* card.hw_btn_disabled */ "Sin configurar.",
  /* card.hw_env_detail */ (sda, scl) => `SDA en GPIO${sda}, SCL en GPIO${scl}.`,
  /* card.hw_env_disabled */ "Sin configurar.",
  /* card.firmware */ "Versión",
  /* card.channel */ "Canal de actualización",
  /* card.firmware_help */ "La versión que se ejecuta actualmente en el ESP32. Toca el valor para buscar una imagen de firmware firmada en el canal de actualización seleccionado.",
  /* card.channel_help */ "Estable sigue las versiones estables publicadas manualmente. Desarrollo sigue la última integración relevante para el firmware. Al cambiar el canal se consulta inmediatamente esa fuente.",
  /* chan.release */ "Estable",
  /* chan.dev */ "Desarrollo",
  /* chan.saved */ (c) => `Canal de actualización: ${c}`,
  /* card.proto_title */ "Protocolo",
  /* card.fw_title */ "Firmware",
  /* settings.diagnostics */ "Diagnóstico de la instalación",
  /* card.language */ "Idioma",
  /* card.language_help */ "Navegador usa la preferencia de idioma del navegador. Al elegir un idioma se guarda un idioma fijo para la interfaz de todo el dispositivo.",
  /* card.diagnostics */ "Diagnóstico de la instalación",
  /* card.diagnostics_help */ "Activa la comprobación de la instalación de 24 horas, el diagnóstico de la curva de calefacción y fuentes adicionales como la temperatura ambiente, la previsión meteorológica y la potencia de la bomba de circulación.",
  /* diagnostics.off */ "Desactivado",
  /* diagnostics.on */ "Activado",
  /* diagnostics.saved_on */ "Diagnóstico de la instalación activado — la recopilación comienza ahora",
  /* diagnostics.saved_off */ "Diagnóstico de la instalación desactivado — recopilación detenida",
  /* probe.toggle */ "Diagnóstico del protocolo",
  /* probe.intro */ "Lectura directa de una página de registros X10A con evaluación opcional del convertidor.",
  /* probe.request */ "Solicitud",
  /* probe.register */ "Registro",
  /* probe.manual */ "Entrada manual",
  /* probe.page */ "Página de registro",
  /* probe.offset */ "Desplazamiento en la carga útil",
  /* probe.size */ "Ancho del campo",
  /* probe.byte */ "byte",
  /* probe.bytes */ "bytes",
  /* probe.converter */ "Convertidor",
  /* probe.page_help */ "Hexadecimal o decimal · 0…255",
  /* probe.offset_help */ "Índice en la carga útil · 0…31",
  /* probe.size_help */ "Bytes que se decodifican",
  /* probe.converter_auto */ "Automático",
  /* probe.converter_auto_help */ size=>`Prueba todos los convertidores implementados para ${size} byte${Number(size)===1?"":"s"}.`,
  /* probe.conv_raw_byte */ "byte bruto · 0…255",
  /* probe.conv_unsigned_byte */ "byte sin signo",
  /* probe.conv_tenth_byte */ "byte bruto × 0,1",
  /* probe.conv_unsigned_half_byte */ "byte sin signo × 0,5",
  /* probe.conv_signed_raw_le */ "entero con signo · little-endian",
  /* probe.conv_signed_raw_be */ "entero con signo · big-endian",
  /* probe.conv_signed_256_le */ "con signo ÷ 256 · little-endian",
  /* probe.conv_signed_256_be */ "con signo ÷ 256 · big-endian",
  /* probe.conv_signed_tenth_le */ "con signo × 0,1 · little-endian",
  /* probe.conv_signed_tenth_be */ "con signo × 0,1 · big-endian",
  /* probe.conv_signed_tenth_nodata_le */ "con signo × 0,1 · little-endian · 0x8000 = sin datos",
  /* probe.conv_signed_tenth_nodata_be */ "con signo × 0,1 · big-endian · 0x8000 = sin datos",
  /* probe.conv_signed_128_le */ "con signo ÷ 256 × 2 · little-endian",
  /* probe.conv_signed_128_be */ "con signo ÷ 256 × 2 · big-endian",
  /* probe.conv_signed_half_be */ "con signo × 0,5 · big-endian",
  /* probe.conv_signed_hundredth_be */ "con signo × 0,01 · big-endian",
  /* probe.conv_unsigned_raw_le */ "entero sin signo · little-endian",
  /* probe.conv_unsigned_raw_be */ "entero sin signo · big-endian",
  /* probe.conv_unsigned_half_be */ "sin signo × 0,5 · big-endian",
  /* probe.conv_saturation */ "presión → temperatura de saturación",
  /* probe.conv_raw_fan */ "byte bruto / nivel del ventilador",
  /* probe.conv_capacity */ "código de capacidad de la unidad interior",
  /* probe.conv_eeprom_digit */ "dígito EEPROM bruto",
  /* probe.conv_eeprom_pair */ "par de dígitos EEPROM brutos",
  /* probe.conv_bits_high */ "bits 4–6 · contador de 3 bits",
  /* probe.conv_bits_low */ "bits 0–2 · contador de 3 bits",
  /* probe.conv_operation_mode */ "modo de funcionamiento",
  /* probe.conv_error_class */ "clase de error",
  /* probe.conv_error_code */ "código de error Daikin",
  /* probe.conv_indoor_mode */ "modo de unidad interior · nibble alto",
  /* probe.conv_hybrid_mode */ "modo híbrido",
  /* probe.conv_bit */ bit=>`bit ${bit} · 0 o 1`,
  /* probe.conv_unknown */ "convertidor desconocido",
  /* probe.send */ "Leer registro",
  /* probe.querying */ "Consultando…",
  /* probe.action_note */ "Una solicitud por ciclo de sondeo. Bloqueada durante OTA.",
  /* probe.catalog_loading */ "Cargando el perfil activo…",
  /* probe.catalog_empty */ "No hay definiciones de registro disponibles.",
  /* probe.catalog_error */ "No se pudieron cargar los registros del perfil.",
  /* probe.catalog_profile */ profile=>`Perfil: ${profile}`,
  /* probe.catalog_fallback */ (definition,profile)=>`main/def: ${definition} · perfil: ${profile}`,
  /* probe.response */ "Respuesta",
  /* probe.frame */ "Trama",
  /* probe.payload */ "Carga útil",
  /* probe.slice */ "Bytes seleccionados",
  /* probe.interpretation */ "Interpretación",
  /* probe.response_for */ reg=>`Respuesta del registro ${reg}`,
  /* probe.payload_marked */ "Carga útil · bytes seleccionados marcados",
  /* probe.slice_note */ (offset,size,slice)=>`Desplazamiento ${offset} · ${size} byte${size===1?"":"s"} · 0x${String(slice).replace(/\s+/g,"")}`,
  /* probe.full_frame */ "Trama completa",
  /* probe.decode_value */ "Resultado del convertidor",
  /* probe.no_decodes */ "Sin resultado del convertidor.",
  /* probe.refused */ "Valor descartado",
  /* probe.unimplemented */ "No implementado",
  /* probe.aliases */ "también",
  /* probe.invalid */ "Comprueba la página, el desplazamiento, el ancho del campo y el convertidor.",
  /* probe.failed */ "La consulta ha fallado.",
  /* probe.status_ok */ "Respuesta válida",
  /* probe.status_busy */ "Ocupado",
  /* probe.status_no_link */ "Sin enlace X10A",
  /* probe.status_timeout */ "Tiempo agotado",
  /* probe.status_no_reply */ "Sin respuesta",
  /* probe.status_rejected */ "Rechazado",
  /* probe.status_bad_crc */ "Suma de comprobación incorrecta",
  /* probe.status_unexpected_reply */ "Respuesta inesperada",
  /* probe.status_invalid_length */ "Longitud no válida",
  /* probe.status_short_reply */ "Respuesta parcial",
  /* probe.status_out_of_bounds */ "Fuera de la carga útil",
  /* probe.status_error */ "Error",
  /* probe.transport_ok */ "Trama completa y válida.",
  /* probe.transport_busy */ "Hay otra consulta de registro activa.",
  /* probe.transport_no_link */ "El enlace X10A no está disponible.",
  /* probe.transport_timeout */ "La tarea de sondeo no ejecutó la solicitud a tiempo.",
  /* probe.transport_no_reply */ "No se recibieron bytes de respuesta.",
  /* probe.transport_rejected */ "La unidad rechazó esta página de registros.",
  /* probe.transport_bad_crc */ "Respuesta recibida; suma de comprobación no válida.",
  /* probe.transport_unexpected_reply */ "La respuesta pertenece a otra página de registros.",
  /* probe.transport_invalid_length */ "La respuesta anuncia una longitud de trama no válida.",
  /* probe.transport_short_reply */ "Solo se recibió parte de la respuesta.",
  /* probe.transport_out_of_bounds */ "Los bytes solicitados quedan fuera de esta carga útil.",
  /* probe.transport_error */ "La solicitud ha fallado.",
  /* lang.auto */ "Navegador",
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
  /* lang.saved */ "Idioma guardado",
  /* hist.cop_none */ "No se muestra la curva de COP cuando la potencia eléctrica procede de las pinzas CT. Las cargas incluidas dependen del cableado; la potencia térmica registrada termina antes de BUH y no incluye el calor directo de BSH, por lo que no se garantiza la misma frontera de balance.",
]);
INSPECT_I18N.es = inspectValues(
  ["Sin lectura actual:", "el compresor está parado y la unidad exterior solo actualiza sus sensores cuando funciona. Se oculta el valor del último ciclo para no presentarlo como una medición actual."],
  [
    ["Modo de funcionamiento", 0, "Modo de la unidad interior. No confirma por sí solo el compresor ni el caudal."], // status
    ["Clima exterior", "Clima exterior de ENV III", "Temperatura, humedad y presión del ENV III; la ubicación condiciona la lectura exterior."], // env3
    [(d) => d && d.sgSrc === "X10A" ? "Solicitud Smart Grid · X10A" : "Solicitud Smart Grid · Modbus", "Solicitud Smart Grid", (d) => d && d.sgSrc === "X10A"
      ? "Orden externa indicada por los contactos físicos SG-Ready: Libre, Parada forzada, Marcha recomendada o Marcha forzada. No es el modo de calefacción/refrigeración ni demuestra que haya empezado una carga del depósito; una orden enviada por red puede no aparecer en estos contactos."
      : "Orden externa leída del HomeHub: Libre, Parada forzada, Marcha recomendada o Marcha forzada. No es el modo de calefacción/refrigeración ni demuestra que haya empezado una carga del depósito.", (d) => !d || d.sgMode == null
      ? "No hay un valor Smart Grid actual."
      : d.sgMode === 2 && d.sgSrc === "X10A"
      ? "Los contactos SG-Ready indican Marcha recomendada, el estado que gestores como evcc usan como refuerzo. El modo ACS, la 3WV y el caudal muestran por separado si el depósito se está cargando."
      : d.sgMode === 2
      ? "HomeHub indica Marcha recomendada, el estado que gestores como evcc usan como refuerzo. El modo ACS, la 3WV y el caudal muestran por separado si el depósito se está cargando."
      : d.sgMode === 1 ? "El gestor energético informa «parada forzada»."
      : d.sgMode === 3 ? "El gestor energético informa «marcha forzada»."
      : "No hay una solicitud Smart Grid externa; la unidad funciona de forma autónoma."], // sgrequest
    ["Unidad exterior", 0, "Lado de la fuente térmica de una instalación aire-agua. El ventilador mueve aire por el intercambiador y el compresor eleva la presión y temperatura del refrigerante. Es un esquema funcional simplificado; las unidades monobloc, geotérmicas o híbridas tienen otra disposición.", (d) => d.defrost
      ? "Desescarche activo: el circuito se invierte para quitar hielo del evaporador y toma brevemente calor del agua."
      : compressorRunning(d)
      ? d.rps != null
        ? `En marcha: compresor a ${fmt0(d.rps)} rps${d.quiet ? ", limitado por el modo silencioso" : ""}.`
        : "En marcha: HomeHub confirma el compresor activo; la velocidad y las lecturas detalladas requieren X10A."
      : d.ouHeldOver && d.mbFields && d.mbFields.has("out")
      ? "En espera: el compresor está parado. X10A ya no actualiza los sensores exteriores; el aire exterior procede de HomeHub, la descarga queda en «—» y la antigüedad real de esa lectura Modbus es desconocida."
      : "En espera: el compresor está parado y no hay transferencia activa. Los sensores propios de la unidad exterior quedan en «—» para no repetir valores del último ciclo."], // ou
    ["Compresor", 0, "Comprime el refrigerante para elevar su presión y temperatura. La frecuencia en rps indica velocidad, no potencia térmica ni eléctrica por sí sola."], // comp
    ["Aire exterior", 0, "Temperatura en el sensor exterior. En reposo X10A puede quedar retenido; entonces se oculta o se identifica HomeHub."], // out
    ["Intercambiador exterior · R4T", "Temperatura del intercambiador exterior R4T", "Temperatura del intercambiador exterior. En calefacción puede bajar de cero y acumular hielo; se interpreta junto con el estado de desescarche."], // ouhx
    ["Alta presión", 0, "Presión del lado de alta del circuito frigorífico. La cifra puede venir del transductor del compresor en marcha o del sensor de presión utilizable en reposo; no es presión de agua."], // hp
    ["Temperatura de descarga", 0, "Temperatura del gas a la salida del compresor. X10A la mantiene del último ciclo cuando el compresor para, por lo que la lectura actual se oculta en reposo."], // disch
    ["Baja presión", 0, "Presión del refrigerante en el lado de baja del compresor, tras la expansión durante calefacción. Algunos perfiles no ofrecen un transductor válido; en ese caso aparece «—»."], // lp
    ["Válvula de expansión", 0, "Dosifica refrigerante y reduce su presión. La posición se expresa en impulsos de mando, no como porcentaje ni como confirmación mecánica de apertura."], // eev
    ["Refrigerante líquido · R3T", "Temperatura del refrigerante líquido R3T", "Temperatura del refrigerante en el lado líquido del intercambiador interior. No es la temperatura de retorno del agua."], // r3t
    ["Intercambiador de placas", 0, "Transfiere energía entre refrigerante y agua sin mezclarlos. La potencia mostrada se estima con caudal y R1T/R4T; la posición física exacta de esos sensores depende del modelo.", (d) => !compressorRunning(d, 5)
      ? "Sin transferencia frigorífica activa: el compresor está parado. La bomba puede redistribuir calor residual, pero eso no es potencia de calefacción ni de refrigeración."
      : d.dtStale ? "No se puede calcular la transferencia al agua: bomba y caudal no demuestran movimiento por las placas."
      : d.pth == null ? "Las lecturas no permiten estimar una transferencia útil en la dirección del modo seleccionado."
      : d.pthKind === "cooling"
      ? `Se extraen unos ${fmt1(d.pth)} kW del agua: ${fmt1(d.flow)} l/min con ΔT ${fmt1(d.dt)} K.`
      : `Se transfieren unos ${fmt1(d.pth)} kW al agua: ${fmt1(d.flow)} l/min con ΔT ${fmt1(d.dt)} K.`], // phe
    ["Salida PHE · antes de BUH · R1T", "Salida de agua PHE antes de BUH R1T", "Temperatura del agua al salir del PHE antes del calentador auxiliar. No incluye el calor eléctrico añadido después por BUH."], // lwt
    ["Impulsión tras BUH · R2T", "Impulsión de agua después de BUH R2T", "Temperatura de agua medida después de BUH. A diferencia de R1T, puede incluir calor del calentador auxiliar; su posición exacta respecto a bomba y válvulas depende de la unidad hidráulica."], // r2t
    ["Entrada PHE · R4T", "Entrada de agua PHE R4T", "Temperatura del agua que vuelve al PHE. Es un sensor interno del circuito hidráulico, no un sensor dedicado en los emisores del edificio."], // rwt
    ["ΔT del agua en el PHE", "Delta T del agua en el PHE", "R1T en la salida del PHE menos R4T en la entrada. Se calcula a partir de dos sensores; junto con el caudal describe la transferencia, pero no mide directamente la impulsión y el retorno en los emisores.", (d) => d.dtStale
      ? "No hay ΔT de trabajo: bomba y caudal no demuestran circulación. Sin movimiento, la diferencia entre sensores no es un punto de funcionamiento."
      : d.dt == null ? null
      : !compressorRunning(d, 5) ? `${fmt1(d.dt)} K con solo circulación de bomba: igualación de calor residual, no potencia térmica.`
      : d.thermalMode === "cool" ? `${fmt1(d.dt)} K. En refrigeración activa R1T debe estar por debajo de R4T, por eso la diferencia es negativa.`
      : `${fmt1(d.dt)} K${d.dtSet != null ? ` frente al objetivo de calefacción de ${fmt1(d.dtSet)} K` : ""}. Un valor positivo indica que el PHE aporta calor al agua.`], // dt
    [(d) => d && d.pthKind === "cooling" ? "Potencia de frío estimada" : "Potencia térmica estimada", "Potencia térmica estimada en el PHE", (d) => d && d.pthKind === "cooling"
      ? "Estimación del calor extraído: caudal × (R4T−R1T) × 4,186 kJ/kg·K suponiendo agua. Depende de caudal, sensores y fluido; con glicol cambia. Solo se muestra con compresor en marcha y diferencia en dirección de refrigeración."
      : "Estimación del calor entregado: caudal × (R1T−R4T) × 4,186 kJ/kg·K suponiendo agua. Depende de caudal, sensores y fluido; con glicol cambia. BUH está después de R1T y queda fuera de esta cifra.", (d) => d.dtStale
      ? d.bsh === true
        ? "No se calcula transferencia en el PHE porque no se demuestra circulación. La resistencia interna aún puede calentar el depósito, pero su calor no cruza R1T/R4T y este bus no puede cuantificarlo."
        : "No se calcula potencia porque no se demuestra movimiento de agua por el PHE. Falta un punto de trabajo; no significa 0 kW."
      : d.pth == null ? null
      : d.pthKind === "cooling" ? `≈ ${fmt1(d.pth)} kW de frío${d.cop != null ? `; EER ${fmt1(d.cop)}` : ""}.`
      : `≈ ${fmt1(d.pth)} kW${d.cop != null && !d.copPostBuh ? `; COP ${fmt1(d.cop)}` : ""}.`], // pth
    [(d) => d && d.efficiencyKind === "eer" ? "EER estimado de la bomba de calor"
      : d && d.copScope === "plant" ? "COP estimado tras BUH" : "COP estimado de la bomba de calor", "Eficiencia estimada", (d) => d && d.efficiencyKind === "eer"
      ? "Potencia frigorífica estimada dividida por entrada eléctrica estimada. Hereda las incertidumbres del fluido, sensores, tensión y factor de potencia. Es un EER instantáneo, no estacional; la energía medida durante una temporada es más representativa."
      : "Potencia térmica estimada dividida por entrada eléctrica estimada, usando límites compatibles: tras BUH con CT cuando existe R2T, o solo la bomba de calor con corriente del inversor. El cableado CT decide qué cargas incluye. Es una indicación instantánea, no un contador certificado.", (d) => d.copBlock === "tank_heater"
      ? "Sin COP: la resistencia del depósito puede estar incluida en la electricidad, pero su calor va directo al depósito y no cruza los sensores de impulsión; los límites no coinciden."
      : d.copBlock === "buh_no_r2t" ? "Sin COP: BUH está activo, pero falta un sensor posterior. La electricidad puede incluir el calentador mientras el calor se calcula antes de él."
      : d.copBlock === "mb_scope" ? "Sin COP: HomeHub mide electricidad de toda la unidad, pero el calor solo del PHE y no aporta estados de calentadores ni sensor posterior para igualar los límites."
      : d.copBlock === "no_pel"
      ? d.pelHeld ? "Sin COP: el compresor está parado y la corriente del inversor es del último ciclo, no actual."
        : "Sin COP: este perfil no aporta entrada eléctrica mediante CT ni corriente del inversor."
      : d.cop == null ? null
      : d.efficiencyKind === "eer" ? `${fmt1(d.cop)} kW de frío por kW eléctrico: ≈ ${fmt1(d.copPth)} kW extraídos con ≈ ${fmt1(d.pel)} kW de entrada.`
      : d.copScope === "plant" ? `${fmt1(d.cop)} kW térmicos tras BUH por kW eléctrico estimado con CT: ≈ ${fmt1(d.copPth)} kW / ≈ ${fmt1(d.pel)} kW. El cableado CT determina las cargas incluidas.`
      : `${fmt1(d.cop)} kW térmicos por kW eléctrico dentro del límite de la bomba de calor: ≈ ${fmt1(d.copPth)} kW / ≈ ${fmt1(d.pel)} kW. BUH queda fuera de ambas cifras.`], // cop
    ["Calentador auxiliar · BUH", "Calentador auxiliar BUH", "Calentador eléctrico del circuito de agua situado después de R1T. Sus etapas pueden elevar la temperatura de impulsión y el consumo; no es la resistencia interna del depósito BSH.", (d) => d.buh1 == null && d.buh2 == null ? null : d.buh2 ? "Etapa 2: ambas etapas calientan." : d.buh1 ? "Etapa 1: una etapa calienta." : "Inactivo: ninguna etapa BUH está activa."], // buh
    ["Resistencia del depósito", "Resistencia eléctrica del depósito", "Resistencia eléctrica de inmersión BSH dentro del depósito. Puede calentar el agua con compresor, bomba y caudal a cero; su contacto X10A no mide potencia.", () => {
      const on = x10aDown() ? null : vOn(/^bsh$/i);
      return on == null ? null : on ? "Resistencia del depósito activa." : "Inactiva: la resistencia del depósito está apagada.";
    }], // bsh
    ["Válvula de 3 vías", 0, "La salida lógica selecciona el camino del depósito o de climatización. No es una confirmación mecánica de posición ni una prueba de caudal.", (d) => d.valveDhw == null ? null : d.valveDhw
      ? "El control indica el camino del depósito. Esto no demuestra posición mecánica, caudal ni carga activa."
      : "El control indica el camino de climatización. Esto no demuestra posición mecánica ni circulación."], // valve
    ["Salida de válvula de 2 vías", 0, "Salida binaria X10A para una 2WV del circuito de climatización. No informa de la posición mecánica ni equivale al modo calefacción/refrigeración.", (d) => d.valve2On == null ? null : d.valve2On
      ? "X10A indica la salida 2WV activa. No demuestra calefacción activa ni posición mecánica; comprueba modo y funcionamiento de climatización."
      : "X10A indica la salida 2WV inactiva. No significa por sí sola refrigeración ni contradice un modo de calefacción configurado, sobre todo en reposo."], // valve2
    ["Depósito ACS", "Depósito ACS o acumulador térmico", "Depósito medido por R5T. Carga, consigna y resistencia BSH se muestran por separado."], // tank
    [(d) => activeSpaceKind(d) === "cool" ? "Circuito de refrigeración" : activeSpaceKind(d) === "heat" ? "Circuito de calefacción" : "Circuito de climatización", "Circuito de climatización", "Emisores del edificio: radiadores, suelo radiante o fan coils. La instalación decide si calientan, refrigeran o ambas cosas; R1T/R4T se miden dentro de la bomba y no confirman la temperatura en los emisores.", (d) => d.valveDhw === true
      ? "El camino de climatización no está seleccionado; bomba y caudal muestran aparte si circula agua por el depósito."
      : waterMoving(d)
      ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0
        ? `Circula agua residual caliente hacia climatización. R1T interno: ${degC(d.lwt)}; ningún sensor posterior confirma la temperatura de los emisores. No es refrigeración activa.`
        : `El agua va al circuito de ${activeSpaceKind(d) === "cool" ? "refrigeración" : activeSpaceKind(d) === "heat" ? "calefacción" : "climatización"}. R1T interno: ${degC(d.lwt)}; no hay sensor posterior en los emisores.`
      : "Bomba y caudal actuales no demuestran circulación por el ramal de climatización."], // heat
    ["Climatización activa", "Funcionamiento de climatización", "Señal de funcionamiento normal de calefacción/refrigeración de espacios. No es demanda de termostato ni demuestra por sí sola que el compresor esté activo."], // spaceh
    ["Temperatura ambiente", 0, "Temperatura y consigna de la zona de referencia; dependen de la ubicación del sensor."], // room
    ["Bomba de circulación", "Velocidad de la bomba de circulación", "Mueve agua por el circuito común y el ramal elegido por la 3WV. Puede seguir funcionando con el compresor parado por postcirculación, protección o igualación; velocidad y caudal deben interpretarse juntos.", (d) => d.pump == null && d.flow == null && d.pumpOn == null ? null
      : pumpFlowConflict(d) ? `La bomba interna indica parada, pero el sensor mide ${fmt1(d.flow)} l/min. Puede haber circulación externa, postcirculación o señales discrepantes; revisa ambas.`
      : d.pump != null && d.pump > 0 ? d.flow != null ? `Velocidad ${fmt0(d.pump)} %; caudal medido ${fmt1(d.flow)} l/min.` : `Velocidad ${fmt0(d.pump)} %, pero falta el caudal; la circulación no está confirmada.`
      : waterMoving(d) ? `El sensor mide ${fmt1(d.flow)} l/min aunque no hay una velocidad de bomba utilizable.`
      : d.pumpOn === true ? d.flow != null ? `Bomba activa, pero solo ${fmt1(d.flow)} l/min; no se demuestra circulación.` : "Bomba activa, pero falta el caudal; la circulación no está confirmada."
      : d.pumpOn === false || d.pump === 0 ? d.flow != null ? `Bomba parada; el sensor indica ${fmt1(d.flow)} l/min. Estas señales no demuestran circulación.` : "Bomba parada y sin medición de caudal."
      : `No hay un estado fiable de la bomba; ${fmt1(d.flow)} l/min no basta para demostrar circulación.`], // pump
    [(d) => pelMeasured(d) ? "Consumo eléctrico · HomeHub" : "Consumo eléctrico estimado", "Consumo eléctrico", (d) => pelMeasured(d)
      ? "Valor de consumo comunicado por HomeHub entrada 51. La UI no lo calcula, pero la guía pública no demuestra calibración, punto de medida ni qué calentadores incluye; no es un contador certificado de toda la instalación."
      : "Estimación para COP/EER. Con CT suma todas las fases declaradas y usa corriente × 230 V supuestos; tensión y factor de potencia reales son desconocidos. La corriente del inversor cubre solo el compresor.", (d) => d.pelHeld ? "El compresor está parado; la corriente del inversor pertenece al último ciclo y no es actual, por lo que no puede indicarse consumo ni eficiencia."
      : d.pel == null ? "Este perfil no aporta una lectura eléctrica actual; tampoco puede calcularse COP/EER."
      : d.pelSrc === "MB" ? "Comunicado por HomeHub entrada 51; el límite exacto de medición no está documentado."
      : d.pelSrc === "CT" ? "Estimado con pinzas CT; las cargas incluidas dependen del cableado."
      : "Calculado con la corriente del inversor, solo para el compresor."], // pel
    ["Desescarche", 0, "Invierte temporalmente el circuito para eliminar hielo del intercambiador exterior. Es normal con tiempo frío y húmedo y toma brevemente calor del agua.", (d) => d.defrost == null ? null : d.defrost ? "Desescarche activo." : "Inactivo: no hay un ciclo de desescarche."], // defrost
    ["Modo silencioso", 0, "Modo que limita ruido y normalmente velocidad o potencia de la unidad exterior. La señal indica el estado del modo, no el nivel exacto ni su efecto térmico.", (d) => d.quiet == null ? null : d.quiet ? "Modo silencioso activo." : "Inactivo: el modo silencioso está desactivado."], // quiet
    ["Línea de gas", "Línea de gas refrigerante", "Línea frigorífica entre unidades en el esquema split. En calefacción lleva gas caliente a alta presión al PHE; en refrigeración el flujo se invierte. Un monobloc no tiene esta línea frigorífica de campo.", (d) => compressorRunning(d) ? d.rps != null ? `En circulación: ${fmt1(d.circP)} bar a ${fmt0(d.disch)} °C.` : "En circulación: HomeHub confirma el compresor; presión y descarga requieren X10A." : "Sin circulación frigorífica activa: compresor parado. La igualación de presión depende del circuito y del tiempo de reposo."], // rhot
    ["Línea de líquido", "Línea de líquido refrigerante", "Línea frigorífica entre unidades en el esquema split. En calefacción devuelve refrigerante condensado a alta presión hacia la válvula de expansión exterior; en refrigeración se invierte. Un monobloc no tiene esta línea de campo.", (d) => compressorRunning(d) ? d.rps != null ? `En circulación: válvula de expansión a ${fmt0(d.eev)} impulsos.` : "En circulación: HomeHub confirma el compresor; la posición de la válvula requiere X10A." : "Sin circulación: el compresor está parado."], // rcold
    ["Tubería de salida PHE", "Tubería de salida del PHE", "Agua que sale del PHE por R1T y pasa por BUH, bomba y 3WV. En calefacción/ACS es el lado caliente y en refrigeración activa el frío; R1T queda antes de BUH y de los ramales.", (d) => waterMoving(d) ? `R1T antes de BUH: ${degC(d.lwt)} a ${fmt1(d.flow)} l/min${d.buh1 || d.buh2 ? "; hay una etapa BUH activa después" : ""}.` : "Bomba y caudal no demuestran circulación en esta tubería."], // wsup
    ["Circuito del depósito", "Circuito hidráulico del depósito", "Ramal hidráulico que carga el depósito ACS o acumulador. El intercambiador interno depende del modelo; el dibujo muestra la función, no la construcción exacta. En este esquema desviado, la carga pausa el flujo directo a climatización.", (d) => d.valveDhw === true ? waterMoving(d) ? `Camino del depósito seleccionado: ${fmt1(d.flow)} l/min, salida PHE ${degC(d.lwt)}, depósito ${degC(d.tank)}.` : "Camino del depósito seleccionado, pero bomba y caudal no demuestran una carga activa." : "Camino del depósito no seleccionado; el control indica climatización."], // wtank
    [(d) => activeSpaceKind(d) === "cool" ? "Ramal de refrigeración" : activeSpaceKind(d) === "heat" ? "Ramal de calefacción" : "Ramal de climatización", "Ramal hidráulico de climatización", "Ramal hacia radiadores, suelo radiante, fan coils u otros emisores. R1T/R4T se miden en la unidad hidráulica y no demuestran la temperatura en este ramal ni la carga del edificio.", (d) => d.valveDhw === true ? "El ramal de climatización no está seleccionado; el control indica el depósito."
      : waterMoving(d) ? d.thermalMode === "cool" && !compressorRunning(d, 5) && d.pthRaw != null && d.pthRaw > 0
        ? `Circulación de calor residual hacia climatización a ${fmt1(d.flow)} l/min; no hay refrigeración activa. R1T ${degC(d.lwt)}, R4T ${degC(d.ret)}; no se mide el lado de campo.`
        : `Circulación hacia climatización a ${fmt1(d.flow)} l/min. Sensores internos: R1T ${degC(d.lwt)}, R4T ${degC(d.ret)}.`
      : "Bomba y caudal no demuestran circulación por el ramal de climatización."], // wheat
    ["Tubería de entrada PHE", "Tubería de entrada del PHE", "Retorno común al PHE por R4T después de unir los ramales. En calefacción suele estar más frío que R1T y en refrigeración activa más caliente; R4T no es un sensor dedicado en los emisores.", (d) => waterMoving(d) ? `Retorno a ${degC(d.ret)}, ${fmt1(d.flow)} l/min y ${fmt1(d.wp)} bar.` : "Bomba y caudal no demuestran circulación en el retorno."], // wret
    ["Caudal", "Caudal de agua", "Caudal del circuito común. El mínimo depende del modelo; interprétalo con bomba y presión."], // flow
    ["Estado del flujostato", 0, "Entrada binaria X10A; no mide l/min ni confirma el caudal mínimo.", (d) => d.flowSwitch == null ? null : d.flowSwitch ? `X10A activo; compáralo con bomba y ${fmt1(d.flow)} l/min.` : `X10A inactivo; con bomba activa, compara ${fmt1(d.flow)} l/min y fallos 7H/C0.`], // flow_switch
    ["Presión de agua", 0, "Presión del circuito hidráulico, no del refrigerante. El intervalo permitido depende del modelo y de la instalación; compárala con el manual exacto."], // wp
  ],
);

HOMEHUB_LABEL_I18N.es = homeHubValues([
  "Objetivo de impulsión en calefacción · zona principal", // 1
  "Objetivo de impulsión en refrigeración · zona principal", // 2
  "Modo calefacción/refrigeración", // 3
  "Climatización habilitada", // 4
  "Objetivo de calefacción · zona principal", // 6
  "Objetivo de refrigeración · zona principal", // 7
  "Modo silencioso", // 9
  "Objetivo de recalentamiento ACS", // 10
  "Estado de diagnóstico de la unidad", // 21
  "Código de fallo de la unidad", // 22
  "Subcódigo de fallo de la unidad", // 23
  "Bomba de circulación activa", // 30
  "Compresor activo", // 31
  "Resistencia del depósito activa", // 32
  "Desinfección del depósito activa", // 33
  "Posición de la válvula de 3 vías", // 37
  "Modo actual de calefacción/refrigeración", // 38
  "Impulsión a la salida del PHE", // 40
  "Impulsión después de BUH", // 41
  "Temperatura de retorno", // 42
  "Temperatura del depósito ACS", // 43
  "Temperatura exterior", // 44
  "Temperatura del refrigerante líquido", // 45
  "Caudal", // 49
  "Temperatura ambiente de la zona principal", // 50
  "Consumo eléctrico", // 51
  "Funcionamiento ACS", // 52
  "Funcionamiento de climatización", // 53
  "Corrección de impulsión · zona principal", // 54
  "Modo Smart Grid", // 56
  "Límite de potencia para acumulación", // 57
  "Límite general de potencia", // 58
]);

DESCRIPTION_I18N.es = descriptionValues([
  ["Temperatura objetivo del depósito de ACS o acumulador térmico."], // 0
  ["Lectura de un segundo sensor del depósito, por ejemplo el inferior en un acumulador con sensores arriba y abajo."], // 1
  ["Temperatura indicada por el sensor R5T."], // 2
  ["El modo potente inicia de inmediato la carga del depósito hasta la consigna de confort o almacenamiento."], // 3
  ["Precalentamiento X10A antes de demanda o programa; no es la desinfección HomeHub ni la demuestra."], // 4
  ["La entrada HomeHub 33 indica desinfección activa; un pulso completo entre sondeos Modbus puede no registrarse."], // 5
  ["Bit de termostato exterior, distinto de la demanda interior y no prueba del compresor."], // 6
  ["Bit exterior de bajo ruido; no están demostrados ni el nivel silencioso ni el origen de la orden."], // 7
  ["Bit de entrada solar del circuito hidráulico; su función y polaridad no están demostradas."], // 8
  ["Fase interna de espera o arranque, no calor útil; un ON breve al arrancar puede ser normal."], // 9
  ["El control exterior informa de una operación interna que devuelve aceite frigorífico al compresor."], // 10
  ["Fase de igualación frigorífica, no presión medida ni posición confirmada de válvula."], // 11
  ["Demanda exterior propietaria sin significado documentado; úsala solo para correlacionar."], // 12
  ["Orden/estado de 4WV; no confirma posición y la polaridad requiere modo y temperaturas."], // 13
  ["Orden/estado del calentador de cárter, no corriente ni temperatura; puede actuar con compresor parado."], // 14
  ["Bit propietario de salida; no prueba movimiento ni polaridad: compáralo con presión y temperaturas."], // 15
  ["Subcódigo interior sin tabla validada por modelo; cero no descarta un fallo principal."], // 16
  ["Orden/estado de válvula de suelo, no posición ni caudal; polaridad sin confirmar."], // 17
  ["ON significa sistema apagado, pero protecciones, bombas o calentadores aún pueden funcionar."], // 18
  ["Entrada de termostato externo adicional, no temperatura ni compresor; compárala con el contacto configurado."], // 19
  ["Demanda del termostato principal calor/frío; confirma respuesta con modo, bomba, válvula y compresor."], // 20
  ["Uno de cuatro bits brutos del límite; no deduzcas una etapa hasta demostrar la codificación observada."], // 21
  ["Bit de calentador PHE: no se sabe si es orden o feedback y no prueba corriente."], // 22
  ["El recalentamiento eleva de nuevo el depósito hasta su consigna cuando cae por debajo del umbral de arranque."], // 23
  ["Preajuste programado: Confort usa el objetivo alto y Eco el bajo."], // 24
  ["En un sistema híbrido, el control solicita ACS a la caldera."], // 25
  ["3WV dirige agua a ACS o ambiente; 1=ACS y 0=ambiente, pero la posición no prueba actividad."], // 26
  ["Salida X10A ON/OFF para una 2WV opcional; no demuestra modo, tensión ni posición mecánica."], // 27
  ["Apertura de la válvula mezcladora de una segunda zona."], // 28
  ["Objetivo de impulsión del modo de calefacción o refrigeración seleccionado."], // 29
  ["Temperatura de impulsión mezclada de una zona secundaria, después de su válvula mezcladora."], // 30
  ["Temperatura tras BUH, normalmente R2T; incluye su aporte, pero no demuestra la temperatura en los emisores."], // 31
  ["R1T sale del PHE antes de BUH; con R4T y caudal estima potencia por modo, pero su ubicación depende de la unidad."], // 32
  ["Retorno R4T al PHE; evalúa el ΔT con caudal, compresor y modo, no con 5 K universales."], // 33
  ["Caudal del circuito común; el mínimo depende de modelo y modo, y un valor bajo puede causar 7H."], // 34
  ["Presión hidráulica: muchos manuales exigen >1 bar, pero a ≤1,0 bar consulta el manual del modelo exacto."], // 35
  ["Orden de bomba invertida: 0 es velocidad máxima y 100 es parada."], // 36
  ["Estado de bomba; no prueba calor útil y puede actuar sin compresor: compáralo con caudal."], // 37
  ["Estado de la bomba de un circuito solar térmico configurado."], // 38
  ["Velocidad indicada de la bomba nombrada por este perfil."], // 39
  ["Estado X10A del flujostato: ON indica movimiento detectado, no l/min ni el mínimo; algunos modelos no documentan un contacto físico."], // 40
  ["Modo hidráulico: parada, calor, frío, ACS o combinado; no prueba compresor ni transferencia."], // 41
  ["Orden Smart Grid de cuatro estados leída por HomeHub o derivada de dos contactos X10A; no es el modo calor/frío."], // 42
  ["Modo ambiente vivo calor/frío, sin Auto; no prueba compresor y requiere la actividad."], // 43
  ["Selección HomeHub Auto/calor/frío; es configuración, no estado actual ni prueba actividad."], // 44
  ["Estado exterior parada/calor/frío; puede quedar seleccionado con compresor parado y no prueba calor."], // 45
  ["Desescarche exterior; es normal con frío húmedo, pero este bit solo no diagnostica ciclos excesivos."], // 46
  ["Clase de gravedad del fallo activo: Normal, Error, Aviso o Precaución."], // 47
  ["Significado del código de fallo comunicado actualmente"], // 48
  ["Funcionamiento de emergencia tras un fallo de la bomba de calor."], // 49
  ["Relé de alarma de la unidad; se activa para indicar un fallo a una alarma o supervisión externa conectada."], // 50
  ["Objetivo de temperatura ambiente de la zona principal en calefacción o refrigeración."], // 51
  ["Solicitud interna «thermo ON»; no identifica la carga ni demuestra compresor activo, y «Space heating Operation» no es demanda."], // 52
  ["Salida eléctrica «Space H Operation»; no es actividad normal ni prueba compresor o calor."], // 53
  ["Actividad normal calor/frío, no demanda; puede estar ON en frío con compresor parado."], // 54
  ["Temperatura ambiente objetivo configurada para la zona controlada por el sensor propio de la unidad."], // 55
  ["Temperatura ambiente medida por el sensor integrado o cableado de la unidad."], // 56
  ["Protección de descarga: ON/OFF actual + contador 0–7; solo subida comparable = actividad, no causa; umbral, reset y vuelta 7→0 sin documentar."], // 57
  ["Protección de corriente inverter: ON/OFF actual + contador 0–7; solo subida comparable = actividad, no causa; umbral, reset y vuelta 7→0 sin documentar."], // 58
  ["Protección de alta presión: ON/OFF actual + contador 0–7; solo subida comparable = actividad, no causa; umbral, reset y vuelta 7→0 sin documentar."], // 59
  ["Protección de baja presión: ON/OFF actual + contador 0–7; solo subida comparable = actividad, no causa; umbral, reset y vuelta 7→0 sin documentar."], // 60
  ["Protección térmica inverter: ON/OFF actual + contador 0–7; solo subida comparable = actividad, no causa; umbral, reset y vuelta 7→0 sin documentar."], // 61
  ["Bit interno genérico de limitación no asignado a las cinco protecciones nombradas."], // 62
  ["Temperatura del agua en la entrada o salida del intercambiador de placas que transfiere calor entre refrigerante y circuito."], // 63
  ["Sensor del intercambiador exterior; <0 °C puede ser normal y sin humedad no prueba hielo."], // 64
  ["Temperatura exterior medida por la unidad, usada para compensación climática y decisiones de funcionamiento."], // 65
  ["Gas caliente a la salida del compresor; depende de presión, velocidad, modo y carga. Un valor o un rango de otra familia no prueba fallo ni falta de refrigerante."], // 66
  ["Temperatura del gas refrigerante frío y de baja presión que retorna al compresor."], // 67
  ["Temperatura del refrigerante en la línea de líquido entre intercambiadores."], // 68
  ["Temperatura del refrigerante a la entrada/salida del evaporador, el intercambiador que absorbe calor."], // 69
  ["Temperatura de la línea de inyección de refrigerante, usada internamente para controlar la inyección y proteger el ciclo."], // 70
  ["Temperatura medida en una parte bifásica, con líquido y vapor, del circuito frigorífico."], // 71
  ["Sensor de deshielo exterior; posición y control dependen del modelo. Un punto no prueba hielo en toda la batería ni el fin del desescarche."], // 72
  ["Temperatura de saturación calculada desde la presión; no es un sensor separado ni una presión en bar."], // 73
  ["Presión alta o baja: valorar una tendencia estable del mismo modo/modelo; arranque, retorno de aceite y desescarche la cambian. No hay rango universal."], // 74
  ["Velocidad del compresor en rps; depende del modelo, mayor suele pedir más, pero no mide calor."], // 75
  ["Orden EEV en pasos, no realimentación mecánica, % ni caudal. Por sí sola no prueba movimiento, bloqueo o falta de refrigerante."], // 76
  ["Temperatura de la electrónica de control del motor del ventilador exterior."], // 77
  ["Velocidad del ventilador exterior, en etapa o rpm."], // 78
  ["Objetivo interno según modelo/modo; comparar con la saturación derivada de la presión correspondiente. La diferencia no diagnostica la causa ni la carga."], // 79
  ["Objetivo interno de temperatura de descarga/puerto del compresor, usado por las protecciones de la unidad."], // 80
  ["ΔT objetivo entre impulsión y retorno; depende de modelo y modo, no de una regla universal de 5 K."], // 81
  ["Refrigerante cargado en la unidad, por ejemplo R32 o R410A."], // 82
  ["Temperatura medida en un puerto del compresor para su supervisión y protección internas."], // 83
  ["Lectura de presión del circuito frigorífico de la unidad exterior."], // 84
  ["Corriente de fase por CT; la estimación a 230 V no está calibrada e ignora tensión real y factor de potencia."], // 85
  ["Corriente absorbida por el inversor del compresor; indica aproximadamente su esfuerzo."], // 86
  ["Temperatura del disipador del inversor/electrónica de potencia exterior."], // 87
  ["Etapa o etapas activas del calentador auxiliar eléctrico, expresadas como nivel de potencia."], // 88
  ["Etapa de potencia BUH: 0=ninguna; una superior puede apoyar a baja temperatura, en desescarche, ACS o emergencia según ajustes."], // 89
  ["Entrada HomeHub 32: estado ON/OFF de BSH, no potencia; la entrada 51 es consumo de la bomba de calor, no de BSH."], // 90
  ["BSH del depósito puede calentar sin compresor o bomba; X10A da ON/OFF, no potencia."], // 91
  ["Estado de la cadena de protección térmica de un calentador eléctrico, que interrumpe su funcionamiento al abrirse."], // 92
  ["Protección antihielo de tuberías; depende del modelo, requiere alimentación y no cubre un corte eléctrico."], // 93
  ["Estado antihielo X10A; sin datos del modelo no identifica bomba, calentador ni zona protegida."], // 94
  ["Circuito geotérmico de salmuera y su bomba; fluido, presión y límites dependen del diseño y manual."], // 95
  ["Fuente híbrida bomba/combinada/caldera; es una selección, no calor medido."], // 96
  ["Objetivo de impulsión híbrido, no temperatura medida; interprétalo con modo y valores reales."], // 97
  ["Permiso/estado bivalente; ON no demuestra que la caldera esté encendida."], // 98
  ["Solicitud a caldera; no prueba quemador ni calor entregado."], // 99
  ["Objetivo de agua de caldera, no temperatura medida; depende de demanda e instalación."], // 100
  ["Valor bivalente BE_COP; significado y escala X10A no documentados, no es el COP actual."], // 101
  ["Entrada de tarifa, Smart Grid o solar; la acción depende de configuración y ON solo indica el contacto."], // 102
  ["Capacidad nominal/clase fija interior o exterior, en kW o código; no es medida actual."], // 103
  ["El modo silencioso reduce el ruido exterior y puede limitar la capacidad disponible de calefacción o refrigeración."], // 104
  ["Estado HomeHub Sin error/Fallo/Aviso; por sí solo no identifica la causa."], // 105
  ["Significado del código de fallo comunicado actualmente"], // 106
  ["Subcódigo complementario; solo vale con estado/código principal y se oculta si no está disponible."], // 107
  ["HomeHub indica compresor ON/OFF, no velocidad ni capacidad; interprétalo con operación y caudal."], // 108
  ["Indica si está activo el funcionamiento normal de ACS."], // 109
  ["Indica si está activa la calefacción o refrigeración ambiente normal."], // 110
  ["Salida PHE antes de BUH; compárala con retorno solo con circulación para obtener ΔT."], // 111
  ["Impulsión tras BUH; una subida puede ser aporte eléctrico, pero confírmala con el estado BUH."], // 112
  ["Temperatura del agua medida en el depósito ACS."], // 113
  ["Temperatura de línea líquida; su relación depende del modo y un valor aislado no diagnostica."], // 114
  ["Temperatura ambiente de la zona principal comunicada por el mando remoto."], // 115
  ["Consumo eléctrico vía HomeHub; depende de modo y cargas y no debe atribuirse entero al compresor."], // 116
  ["Objetivo de impulsión calor HomeHub, solo lectura; fijo o climático, y bajarlo solo mejora eficiencia si se alcanza la consigna ambiente."], // 117
  ["Objetivo de impulsión frío HomeHub, solo lectura; solo es relevante si el frío está admitido y habilitado, aunque puede quedar visible."], // 118
  ["Indica si el circuito ambiente está habilitado: es el interruptor, no la actividad actual."], // 119
  ["El modo silencioso reduce el ruido exterior según el nivel configurado y puede reducir la capacidad disponible."], // 120
  ["Objetivo de recalentamiento ACS, no umbral de arranque; también mandan histéresis y programa."], // 121
  ["Corrección −10…+10 K del objetivo de calefacción; no demuestra calor sin funcionamiento ambiente activo."], // 122
  ["Límite de acumulación en Marcha recomendada; rige el menor con el general y no es consumo."], // 123
  ["Límite general HomeHub: techo, no consumo; bajarlo restringe la potencia en los modos Smart Grid."], // 124
]);

MODEL_DESCRIPTION_I18N.es = modelDescriptionValues([
  ["Estado propio de error/aviso: error activo da AVISO; aviso o mensaje borrado en 24 h da NOTA, sin inferencia del proyecto."], // health_fault
  ["Pérdida tranquila: regla del proyecto, NOTA ≥0,8 K/h; volumen y ΔT influyen, >≈1,85 K/h puede filtrarse como consumo y OK no prueba aislamiento."], // health_dhw_loss
  ["NOTA con ≥12 ciclos de calefacción y media <10 min; excluye ACS/frío, no es límite Daikin y si quedan demasiados sin clasificar evalúa todos juntos."], // health_cycling
  ["Cuenta desescarches: NOTA con >15 % y ≥3 ciclos; no es límite Daikin. R4T es contexto en vivo, no entra en el veredicto y un punto no representa toda la batería."], // health_defrost
  ["Presión mínima: >1,0 bar; ≤1,0 da NOTA y tras 60 s ADVERTENCIA, pero el intervalo depende del modelo."], // health_pressure
  ["Caudal tras 60 s de bomba: solo tramo medido; un valor aislado dice poco y se compara en igual modelo, modo y condiciones, sin límite universal."], // health_flow
  ["Tiempo observado de BUH/BSH: frío, emergencia, desescarche, ACS o excedentes pueden explicarlo; no hay límite universal."], // health_heater
  ["5 contadores experimentales poco documentados: solo un aumento comparable da NOTA, no diagnóstico; sin aumentos tampoco se excluye limitación."], // health_retries
  ["RAM libre actual y tendencia de 24 h: una caída persistente puede indicar asignaciones retenidas. Un reinicio con alimentación conserva la tendencia en RAM; un reinicio normal, una actualización o un corte recupera de flash los intervalos cerrados de 5 min. Solo puede faltar el intervalo abierto."], // free_heap
  ["Mayor bloque contiguo necesario para TLS/OTA; si cae con RAM total estable, indica fragmentación."], // max_alloc
  ["Capacidad nominal de la unidad exterior, no su producción actual."], // capacity
  ["Capacidad nominal de la UNIDAD INTERIOR; no corresponde a la exterior ni al sistema completo."], // capacity_iu
  ["Varias familias comparten registros y capacidad: las lecturas son válidas, pero el modelo exacto requiere comparar la ID con la placa."], // candidates
  ["Sin capacidad exterior los candidatos pueden diferir; se usa la mejor coincidencia interior sin certeza, a verificar en la placa."], // candidates_nocap
  ["Bytes de identificación exterior sin mapa público de nombres; si hay ambigüedad, compáralos con la placa."], // oueeprom
]);
