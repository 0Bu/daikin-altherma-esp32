
// ── Boot ─────────────────────────────────────────────────────────────────
function wire() {
  wireModalFieldSelection(document);
  window.addEventListener("popstate", applyRouteFromLocation);
  // pushState traversal across hash routes fires popstate; a user editing the hash in the address
  // bar fires hashchange. Applying the same idempotent route handles both entry paths.
  window.addEventListener("hashchange", applyRouteFromLocation);
  // A route restored before the first status response opens immediately with conservative empty
  // fields. That response may fill an untouched form, but the first real user interaction owns it.
  const keepRouteDraft = () => { _routePopupNeedsHydration = null; };
  document.addEventListener("input", keepRouteDraft);
  document.addEventListener("pointerdown", keepRouteDraft);
  document.addEventListener("keydown", keepRouteDraft);

  // Navigation: the gear opens Settings, the back chevron returns to the dashboard.
  $("btnSettings").onclick = () => go("settings");
  $("btnBack").onclick = goBack;
  $("btnBack").setAttribute("aria-label", t("nav.back"));   // the gear's own label is set by renderSettingsDot
  // Esc leaves the same way the chevron does — but only when nothing else has claimed it:
  // every modal and the schematic inspector install their own Esc handler, and one key closing a
  // dialog AND leaving the screen behind it would be a single gesture doing two things.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || S.stage === "dashboard") return;
    if (S.insp || MODALS.some((id) => !$(id).hidden)) return;
    goBack();
  });

  // The firmware version in the header is static DOM (renderHeaderMeta only rewrites its text), so
  // it takes a direct handler rather than the delegation the rebuilt cards need.
  const vl = $("verLink");
  vl.setAttribute("aria-label", t("aria.ota"));
  vl.onclick = checkFirmwareUpdate;

  // The dashboard card grid (#valueGroups) is rebuilt on every poll, so its one interactive control
  // is wired by delegation: tapping a value row (that has a description) expands/collapses its
  // explainer accordion.
  $("valueGroups").addEventListener("click", (e) => {
    // A scrub that ended on the plot must not fall through to the accordion header and collapse the
    // very panel the user was reading.
    if (e.target.closest("[data-hist]")) return;
    const desc = e.target.closest("[data-desc]");
    if (desc) toggleDesc(desc);
  });
  // Trend scrubbing, delegated for the same reason (the grid is rebuilt every poll). Hover reads
  // out without claiming anything; a press claims the pointer so the readout survives leaving the
  // plot mid-drag, and freezes the rebuild until release.
  //
  // Wired on BOTH containers that can hold a plot — the value grid and the schematic inspector —
  // from one function, so the two can never drift into two slightly different scrub behaviours.
  // Every lookup inside is scoped to the plot the event came from (`closest`, then the plot's own
  // children), never a document-wide id: the same row's chart can be on screen twice at once, and a
  // global lookup would move the cursor on whichever copy happened to be first in the DOM.
  //
  // EVERY pointerdown in a per-poll container holds the rebuild until its click resolves — see
  // renderCards. Registered before the plot handlers and deliberately unfiltered: the row headers
  // are the rows people actually tap, and they are not plots.
  // Arm the click-in-flight hold from EVERY per-poll container that setHtml guards, not just the
  // value grid: #settingsCards and #connTile rely on the unchanged-markup check alone, which
  // protects them only while their markup is stable — a real state change landing on the exact tap
  // that opens a config modal would still be lost. Same guard, same three containers, one rule.
  for (const id of ["valueGroups", "settingsCards", "connTile"]) {
    const el = $(id);
    el.addEventListener("pointerdown", () => clickHold(CLICK_HOLD_DOWN_MS));
    // pointerup RE-ARMS a shorter hold rather than releasing: the click, the open animation and the
    // trend fetch all happen after the finger is up.
    for (const ev of ["pointerup", "pointercancel"]) el.addEventListener(ev, () => clickHold(CLICK_HOLD_UP_MS));
  }
  for (const host of ["valueGroups", "inspCard", "settingsCards"]) wireTrendScrub($(host));

  // Schematic inspector: the SVG hit targets are <g> elements, so Enter/Space need handling by hand
  // (a <g role="button"> gets no native activation). Delegated, because the SVG is static DOM.
  $("schem").addEventListener("click", (e) => {
    const hit = e.target.closest("[data-insp]");
    if (hit) inspectPick(hit.dataset.insp);
  });
  $("schem").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const hit = e.target.closest("[data-insp]");
    if (!hit) return;
    e.preventDefault();          // Space would otherwise scroll the page
    inspectPick(hit.dataset.insp);
  });
  $("inspClose").onclick = () => { S.insp = null; renderInspect(); };
  wireRestOfApp();
}

// Pointer + keyboard scrubbing for every trend plot inside `gv`.
function wireTrendScrub(gv) {
  gv.addEventListener("pointermove", (e) => {
    const plot = e.target.closest("[data-hist]");
    if (!plot) return;
    if (S.scrub && S.scrub !== plot.dataset.hist) return;
    if (S.scrub) scrubArm(plot);              // a live drag keeps re-arming the watchdog
    scrubMove(plot, scrubIndex(plot, e.clientX));
  });
  gv.addEventListener("pointerdown", (e) => {
    const plot = e.target.closest("[data-hist]");
    if (!plot) return;
    S.scrub = plot.dataset.hist;
    scrubArm(plot);
    try { plot.setPointerCapture(e.pointerId); } catch { /* capture is an optimisation, not a requirement */ }
    scrubMove(plot, scrubIndex(plot, e.clientX));
  });
  // The authoritative end of a captured drag: fires on pointerup, on pointercancel AND when the
  // element is removed from the DOM — the one exit the explicit handlers below cannot see.
  gv.addEventListener("lostpointercapture", (e) => {
    const plot = e.target.closest("[data-hist]");
    if (plot) scrubEnd(plot);
  });
  // A mouse leaving clears the readout; a touch ends on pointerup/cancel. pointerout covers the
  // former without also firing for every child element (pointerleave doesn't bubble to this
  // delegate, so the related-target check does that job here).
  gv.addEventListener("pointerout", (e) => {
    const plot = e.target.closest("[data-hist]");
    if (!plot || S.scrub) return;
    if (e.relatedTarget && plot.contains(e.relatedTarget)) return;
    scrubEnd(plot);
  });
  for (const ev of ["pointerup", "pointercancel"]) {
    gv.addEventListener(ev, (e) => {
      const plot = e.target.closest("[data-hist]");
      if (!plot) return;
      // A release ON the plot PINS the sample under it (pointercancel does not — a gesture the
      // browser took away is not a choice the user made). The transient crosshair is torn down
      // either way; the pin is re-emitted by the render that follows, so what the user let go of is
      // exactly what stays on screen.
      // Read the geometry BEFORE tearing anything down: scrubEnd may rebuild, and `plot` is then a
      // detached node whose bounding box is all zeroes.
      const label = plot.dataset.hist;
      const i = e.type === "pointerup" ? scrubIndex(plot, e.clientX) : -1;
      scrubEnd(plot);
      if (i >= 0) histPinToggle(label, i);
    });
  }
  // Keyboard: the plot is focusable, so arrow keys step through samples and the tooltip is the
  // readout. Without this the trend would be mouse/touch-only — the one control on the dashboard
  // that a keyboard couldn't reach.
  gv.addEventListener("keydown", (e) => {
    const plot = e.target.closest("[data-hist]");
    if (!plot) return;
    const n = +plot.dataset.n;
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (!step && !["Home", "End", "Escape", "Enter", " "].includes(e.key)) return;
    e.preventDefault();                       // arrows would otherwise scroll the page
    if (e.key === "Escape") { S.histPin.delete(plot.dataset.hist); scrubEnd(plot); return renderTrendHosts(); }
    if (e.key === "Enter" || e.key === " ") {   // pin what the arrow keys are reading out
      const cur = plot.dataset.cur == null ? n - 1 : +plot.dataset.cur;
      return histPinToggle(plot.dataset.hist, cur);
    }
    const cur = plot.dataset.cur == null ? n - 1 : +plot.dataset.cur;
    const next = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : cur + step;
    plot.dataset.cur = Math.max(0, Math.min(n - 1, next));
    scrubMove(plot, +plot.dataset.cur);
  });
  gv.addEventListener("focusout", (e) => {
    const plot = e.target.closest("[data-hist]");
    if (plot) { delete plot.dataset.cur; scrubEnd(plot); }
  });
}

// The remaining delegated wiring, split out only so the scrub handlers above can be a function of
// their container — same one-time setup, same order as before.
function wireRestOfApp() {
  // The three-card ESP32 group (#settingsCards) is rebuilt every poll too, so its controls are
  // delegated as well: the Hardware row opens the board modal, the Firmware row runs the OTA check,
  // and the Protocol card's RX/TX dropdowns re-run pin auto-detection on change. The check stays on this screen — it
  // reports into the Firmware row's own slot (otaInline paints both slots), so nothing has to
  // navigate to make the flow visible.
  $("settingsCards").addEventListener("click", (e) => {
    // A scrub that ended on a memory row's chart must not fall through to the accordion header and
    // collapse the panel the user was reading — the same guard #valueGroups carries.
    if (e.target.closest("[data-hist]")) return;
    const desc = e.target.closest("[data-desc]");
    if (desc) return toggleDesc(desc);        // the two memory rows expand like any value row
    const act = e.target.closest("[data-act]");
    if (!act) return;
    if (act.dataset.act === "board") openBoard();
    else if (act.dataset.act === "ota") checkFirmwareUpdate();
    else if (act.dataset.act === "ref-temp") openRefTemp();
    else if (act.dataset.act === "weather") openWeather();
    else if (act.dataset.act === "env3") openEnv3();
  });
  $("settingsCards").addEventListener("change", (e) => {
    if (e.target.id === "e32Rx" || e.target.id === "e32Tx") onPinPick();
    else if (e.target.id === "e32Chan") onChannelPick();
    else if (e.target.id === "e32Lang") onLangPick();
  });
  // The Connections tile (#connTile) is rebuilt every poll too — each row's pencil opens its own
  // edit modal (WiFi/MQTT/Syslog/NTP), delegated the same way.
  $("connTile").addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit]");
    if (!edit) return;
    if (edit.dataset.edit === "wifi") openWifi();
    else if (edit.dataset.edit === "mqtt") openMqtt();
    else if (edit.dataset.edit === "syslog") openSyslog();
    else if (edit.dataset.edit === "ntp") openNtp();
    // The Modbus row. It had no branch here at all: the row posts data-edit (like every other row in
    // this tile) while the only "homehub" handler listened for data-act on the separate card, so the
    // pencil opened nothing and the address could not be edited from the tile the row lives in.
    else if (edit.dataset.edit === "homehub") openHomehub();
  });
  // Crash banner: Copy diagnostics / Delete report (ask → del | keep). The download link is a plain
  // <a download> (no handler). The delete is keyed on the SIGNATURE the banner was drawn with, so a
  // new crash landing between the two taps can't be deleted by a question asked about the old one.
  $("crashBanner").addEventListener("click", (e) => {
    const act = e.target.closest("[data-cact]");
    if (!act) return;
    const sig = $("crashBanner").dataset.sig;
    if (act.dataset.cact === "ask")       { S.crashAsk = sig; renderCrashBanner(); }
    else if (act.dataset.cact === "keep") { S.crashAsk = "";  renderCrashBanner(); }
    else if (act.dataset.cact === "del")  deleteCrashReport(sig);
    else if (act.dataset.cact === "copy") copyDiagnostics();
  });
  $("wfCancel").onclick = closeWifi;
  $("wifiBackdrop").onclick = closeWifi;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("wifiModal").hidden) closeWifi(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.insp) { S.insp = null; renderInspect(); } });
  $("wifiForm").addEventListener("submit", (e) => {
    e.preventDefault();
    // NOT trimmed: leading/trailing spaces are valid SSID bytes (an AP may legitimately name itself
    // " home " or "wifi "), so the field is an opaque identifier — trimming it would submit, and try
    // to join, a different network than the one the user selected.
    const ssid = $("wfSSID").value;
    const pass = $("wfPass").value;
    let valid = true;
    if (!ssid || ssid.length > 32) {
      $("wfSSID").classList.add("invalid");
      $("wfSSIDError").hidden = false;
      valid = false;
    } else {
      $("wfSSID").classList.remove("invalid");
      $("wfSSIDError").hidden = true;
    }
    if (pass.length > 0 && (pass.length < 8 || pass.length > 63)) {
      $("wfPass").classList.add("invalid");
      $("wfPassError").hidden = false;
      valid = false;
    } else {
      $("wfPass").classList.remove("invalid");
      $("wfPassError").hidden = true;
    }
    if (!valid) { toast(t("toast.check_wifi"), "err"); return; }
    saveReboot("/set_wifi", { ssid, pass }, {
      btn: "wfBtn",
      showError: wifiFieldError,
      close: closeWifi,
      then: renderApp,
    });
  });
  $("wfSSID").addEventListener("input", () => { $("wfSSID").classList.remove("invalid"); $("wfSSIDError").hidden = true; });
  $("wfPass").addEventListener("input", () => { $("wfPass").classList.remove("invalid"); $("wfPassError").hidden = true; });

  $("mqCancel").onclick = closeMqtt;
  $("mqttBackdrop").onclick = closeMqtt;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("mqttModal").hidden) closeMqtt(); });
  $("mqttForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const broker = $("mqBroker").value.trim();
    if (!validMqtt(broker)) {
      $("mqBroker").classList.add("invalid");
      $("mqError").textContent = t("mq.err_format");
      $("mqError").hidden = false;
      toast(t("toast.check_broker"), "err");
      return;
    }
    saveReboot("/set_mqtt", {
      broker,
      // user is an opaque credential like pass — NOT trimmed. Spaces can be significant in a broker
      // username, and mangling it here would fail auth against a broker that would otherwise accept it.
      user: $("mqUser").value,
      pass: $("mqPass").value,
      clear_creds: $("mqClearCreds").checked,   // explicit credential clear (blank fields keep them)
    }, {
      btn: "mqBtn",
      showError: (msg) => { $("mqBroker").classList.add("invalid"); $("mqError").textContent = msg; $("mqError").hidden = false; },
      close: closeMqtt,
      then: renderApp,
      busyMsg: t("toast.verifying_mqtt"),   // the endpoint pre-flights the broker (DNS→TCP→CONNECT)
      busyLabel: "btn.verifying",
    });
  });
  $("mqBroker").addEventListener("input", () => { $("mqBroker").classList.remove("invalid"); $("mqError").hidden = true; });
  // Typing credentials upgrades the broker scheme to TLS (the bridge refuses plaintext + creds);
  // clearing them again strips the scheme back to bare. Only mutates the broker while editing the
  // credential fields — typing in the broker field itself is left untouched.
  const handleCredsInput = () => {
    // Empty fields are NOT "no credentials". With credentials stored and the remove box unticked, the
    // device KEEPS them — that is the whole point of the empty-means-keep default — so the broker
    // still needs mqtts://. Inferring "no creds" from the fields alone let the else-branch strip the
    // scheme off a broker the user never touched (type a password, change your mind, backspace it —
    // and mqtts://host silently became host), producing a save the firmware then rejects with
    // "Credentials require mqtts://": an error blaming a scheme this page removed on its own.
    // (Ticked, the fields are disabled and this can't fire; the term keeps the intent explicit.)
    const typed = $("mqUser").value.length > 0 || $("mqPass").value.length > 0;
    const hasCreds = typed || (!!S.status?.mqtt?.has_creds && !$("mqClearCreds").checked);
    const broker = $("mqBroker").value.trim();
    if (hasCreds) {
      if (broker) {
        if (!broker.includes("://")) {
          $("mqBroker").value = "mqtts://" + broker;
        } else if (broker.startsWith("mqtt://")) {
          $("mqBroker").value = "mqtts://" + broker.substring(7);
        } else if (broker.startsWith("ws://")) {
          $("mqBroker").value = "wss://" + broker.substring(5);
        }
      }
    } else {
      if (broker.startsWith("mqtts://")) {
        $("mqBroker").value = broker.substring(8);
      } else if (broker.startsWith("wss://")) {
        $("mqBroker").value = broker.substring(6);
      }
    }
  };
  $("mqUser").addEventListener("input", () => { $("mqBroker").classList.remove("invalid"); $("mqError").hidden = true; handleCredsInput(); });
  $("mqPass").addEventListener("input", () => { $("mqBroker").classList.remove("invalid"); $("mqError").hidden = true; handleCredsInput(); });
  // Deliberately does NOT strip an mqtts:// broker back to plaintext the way clearing the cred fields
  // does: dropping credentials is not a request to drop TLS, and an anonymous mqtts:// broker is a
  // valid target. The scheme stays the user's call.
  $("mqClearCreds").addEventListener("change", (e) => {
    setMqttClear(e.target.checked);
    $("mqBroker").classList.remove("invalid"); $("mqError").hidden = true;
  });

  $("rtCancel").onclick = closeRefTemp;
  $("refTempBackdrop").onclick = closeRefTemp;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("refTempModal").hidden) closeRefTemp();
  });
  for (const id of ["rtName", "rtTopic", "rtPath", "rtTimePath", "rtMaxAge"])
    $(id).addEventListener("input", () => {
      $(id).classList.remove("invalid"); $("rtError").hidden = true;
    });
  const refTempInput = () => {
    const input = refTempFormPayload();
    const bad = (id, msg) => {
      $(id).classList.add("invalid");
      $("rtError").textContent = msg;
      $("rtError").hidden = false;
      toast(msg, "err");
      return null;
    };
    if (!input.topic || !validRefTopic(input.topic)) return bad("rtTopic", t("ref.err_topic"));
    if (input.topic && !validRefPath(input.temperature_path))
      return bad("rtPath", t("ref.err_path"));
    if (input.topic && input.timestamp_path && !validRefPath(input.timestamp_path))
      return bad("rtTimePath", t("ref.err_time_path"));
    if (input.topic && (!Number.isInteger(input.max_age_s) || input.max_age_s < 10 || input.max_age_s > 3600))
      return bad("rtMaxAge", t("ref.err_max_age"));
    return input;
  };
  const showRefTempRequestError = (msg) => {
    const field = /maximum age/i.test(msg) ? "rtMaxAge" :
      /timestamp/i.test(msg) ? "rtTimePath" : /JSON path|path is/i.test(msg) ? "rtPath" :
      /name/i.test(msg) ? "rtName" : /topic|mapping/i.test(msg) ? "rtTopic" : null;
    if (field) $(field).classList.add("invalid");
    $("rtError").textContent = msg;
    $("rtError").hidden = false;
    toast(msg, "err");
  };
  // Save owns the complete contract: validate locally, obtain a mapping-bound proof from one fresh
  // live MQTT value, then persist exactly that tested mapping. The second action is disabled while
  // either flow is in flight, so Delete and Save cannot race each other from this dialog.
  const setRefTempActionBusy = (button, on, label) => {
    setBusy(button, on, label);
    if (on) {
      $("rtBtn").disabled = true;
      $("rtDeleteBtn").disabled = true;
    } else {
      $("rtBtn").disabled = false;
      $("rtDeleteBtn").disabled = !S.status?.reference_temperature?.configured;
    }
  };
  $("refTempForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = refTempInput();
    if (!input) return;
    if (S.busy) { toast(t("toast.applying"), "info"); return; }
    S.busy = true;
    setRefTempActionBusy("rtBtn", true, "btn.verifying");
    const idle = () => { S.busy = false; setRefTempActionBusy("rtBtn", false); };
    let testResponse;
    try { testResponse = await post("/test_ref_temp", input); }
    catch {
      idle(); showRefTempRequestError(t("toast.unreachable")); return;
    }
    if (!testResponse.ok) {
      const msg = await errorOf(testResponse, t("ref.test_failed"));
      idle(); showRefTempRequestError(msg); return;
    }
    const testResult = await testResponse.json().catch(() => ({}));
    if (!Number.isInteger(testResult.test_proof) || testResult.test_proof <= 0 ||
        !Number.isFinite(testResult.temperature_c)) {
      idle(); showRefTempRequestError(t("ref.test_failed")); return;
    }

    let r;
    try {
      r = await post("/set_ref_temp", { ...input, test_proof: testResult.test_proof });
    } catch {
      idle(); showRefTempRequestError(t("toast.unreachable")); return;
    }
    if (!r.ok) {
      const msg = await errorOf(r, t("toast.rejected"));
      idle(); showRefTempRequestError(msg); return;
    }
    const res = await r.json().catch(() => ({}));
    idle(); closeRefTemp();
    toast(t(res.saved === false ? "toast.no_changes" : "ref.saved"), res.saved === false ? "info" : "ok");
    await refreshStatus();
  });

  // Delete is the explicit Off path. It does not depend on what is currently typed into the form:
  // posting the empty mapping removes the saved subscription and makes mqtt_reference_reconfigure
  // clear the captured runtime value as the binding changes.
  $("rtDeleteBtn").onclick = async () => {
    if (S.busy) { toast(t("toast.applying"), "info"); return; }
    if (!S.status?.reference_temperature?.configured) return;
    S.busy = true;
    setRefTempActionBusy("rtDeleteBtn", true, "ref.deleting");
    const idle = () => { S.busy = false; setRefTempActionBusy("rtDeleteBtn", false); };
    let r;
    try {
      r = await post("/set_ref_temp", {
        name: "", topic: "", temperature_path: "", timestamp_path: "",
        max_age_s: 600, test_proof: 0,
      });
    } catch {
      idle(); showRefTempRequestError(t("toast.unreachable")); return;
    }
    if (!r.ok) {
      const msg = await errorOf(r, t("toast.rejected"));
      idle(); showRefTempRequestError(msg); return;
    }
    idle(); closeRefTemp();
    toast(t("ref.deleted"), "ok");
    await refreshStatus();
  };

  $("slHost").addEventListener("input", () => { $("slHost").classList.remove("invalid"); $("slError").hidden = true; });

  $("slCancel").onclick = closeSyslog;
  $("syslogBackdrop").onclick = closeSyslog;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("syslogModal").hidden) closeSyslog(); });
  $("syslogForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = $("slHost").value.trim();   // host:port is an address, not a credential — OK to trim
    let host = "";
    let port = 514;
    if (raw) {
      const idx = raw.lastIndexOf(":");
      if (idx !== -1) {
        host = raw.substring(0, idx);
        // Validate the FULL port string. `parseInt(...) || 514` silently turned "0", "abc" and
        // "514abc" into 514 — masking a typo as a valid save. Require all-digits in 1–65535 instead.
        const portStr = raw.substring(idx + 1);
        if (!/^\d+$/.test(portStr) || +portStr < 1 || +portStr > 65535) {
          $("slHost").classList.add("invalid");
          $("slError").textContent = t("sl.err_port");
          $("slError").hidden = false;
          toast(t("toast.check_syslog_port"), "err");
          return;
        }
        port = +portStr;
      } else {
        host = raw;
      }
    }
    saveReboot("/set_syslog", { host, port }, {
      btn: "slBtn",
      showError: (msg) => { $("slHost").classList.add("invalid"); $("slError").textContent = msg; $("slError").hidden = false; },
      close: closeSyslog,
      then: renderApp,
      busyMsg: t("toast.saving_syslog"),
    });
  });

  $("ntpServer").addEventListener("input", () => { $("ntpServer").classList.remove("invalid"); $("ntpError").hidden = true; });
  $("ntpCancel").onclick = closeNtp;
  $("ntpBackdrop").onclick = closeNtp;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("ntpModal").hidden) closeNtp(); });
  $("ntpForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const server = $("ntpServer").value.trim();
    saveReboot("/set_ntp", { server }, {
      btn: "ntpBtn",
      showError: (msg) => { $("ntpServer").classList.add("invalid"); $("ntpError").textContent = msg; $("ntpError").hidden = false; },
      close: closeNtp,
      then: renderApp,
      busyMsg: t("toast.saving_ntp"),
    });
  });

  ["wxLatitude", "wxLongitude"].forEach((id) => {
    $(id).addEventListener("input", clearWeatherError);
    $(id).addEventListener("paste", pasteWeatherCoordinates);
  });
  $("wxCancel").onclick = closeWeather;
  $("weatherBackdrop").onclick = closeWeather;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("weatherModal").hidden) closeWeather(); });
  $("weatherForm").addEventListener("submit", (e) => {
    e.preventDefault();
    let latitude = $("wxLatitude").value.trim();
    let longitude = $("wxLongitude").value.trim();
    const pastedPair = parseWeatherCoordinatePair(latitude) || parseWeatherCoordinatePair(longitude);
    if (pastedPair) {
      latitude = pastedPair.latitude;
      longitude = pastedPair.longitude;
      $("wxLatitude").value = latitude;
      $("wxLongitude").value = longitude;
    }
    const disabled = !latitude && !longitude;
    if (!disabled && (!latitude || !longitude)) {
      if (!latitude) $("wxLatitude").classList.add("invalid");
      if (!longitude) $("wxLongitude").classList.add("invalid");
      $("wxError").textContent = t("wx.err_both");
      $("wxError").hidden = false;
      return;
    }
    const normalizedLatitude = disabled ? "" : normalizeWeatherCoordinate(latitude, -90, 90);
    if (!disabled && normalizedLatitude == null) {
      $("wxLatitude").classList.add("invalid");
      $("wxError").textContent = t("wx.err_latitude");
      $("wxError").hidden = false;
      return;
    }
    const normalizedLongitude = disabled ? "" : normalizeWeatherCoordinate(longitude, -180, 180);
    if (!disabled && normalizedLongitude == null) {
      $("wxLongitude").classList.add("invalid");
      $("wxError").textContent = t("wx.err_longitude");
      $("wxError").hidden = false;
      return;
    }
    latitude = normalizedLatitude;
    longitude = normalizedLongitude;
    $("wxLatitude").value = latitude;
    $("wxLongitude").value = longitude;
    saveReboot("/set_weather", { latitude, longitude }, {
      btn: "wxBtn",
      showError: (msg) => {
        $("wxLatitude").classList.add("invalid");
        $("wxLongitude").classList.add("invalid");
        $("wxError").textContent = msg;
        $("wxError").hidden = false;
      },
      close: closeWeather,
      then: renderApp,
      busyMsg: t("wx.saving"),
    });
  });

  // HomeHub modal. Saves LIVE via /set_hp (no reboot) rather than through saveReboot(): switching the
  // pump link is the one config change the poll engine picks up at the top of its next cycle, exactly
  // like the RX/TX pin picker it sits beside. Port/unit are range-checked here so a typo is an inline
  // field error instead of a round-trip; the device validates them again (logic/config_model.hpp).
  for (const id of ["hhHost", "hhPort", "hhUnit"])
    $(id).addEventListener("input", () => { $(id).classList.remove("invalid"); $("hhError").hidden = true; });
  $("hhSearch").onclick = searchHomehub;
  $("hhCancel").onclick = closeHomehub;
  $("homehubBackdrop").onclick = closeHomehub;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("homehubModal").hidden) closeHomehub(); });
  $("homehubForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const bad = (id, msg) => {
      $(id).classList.add("invalid");
      $("hhError").textContent = msg;
      $("hhError").hidden = false;
      toast(msg, "err");
    };
    const host = $("hhHost").value.trim();
    const port = +($("hhPort").value.trim() || 502);
    const unit = +($("hhUnit").value.trim() || 1);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return bad("hhPort", t("hh.err_port"));
    if (!Number.isInteger(unit) || unit < 1 || unit > 247)   return bad("hhUnit", t("hh.err_unit"));
    setBusy("hhBtn", true);
    const ok = await applyLive({ mb_host: host, mb_port: port, mb_unit_id: unit }, t("hh.saved"));
    setBusy("hhBtn", false);
    if (!ok) return;
    closeHomehub();
    await refreshStatus();
  });

  $("bdCancel").onclick = closeBoard;
  $("boardBackdrop").onclick = closeBoard;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("boardModal").hidden) closeBoard(); });

  // Bound DIRECTLY, not delegated like the card rows above: the footer link is static markup in
  // index.html that no render path rebuilds, so there is no container to delegate through — and the
  // handler outlives every poll, which is the point of keeping it out of #settingsCards.
  $("footBug").onclick = openBug;
  $("bugCancel").onclick = closeBug;
  $("bugClose").onclick = closeBug;
  $("bugBackdrop").onclick = closeBug;
  $("bugGo").onclick = bugPrepare;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("bugModal").hidden) closeBug(); });
  $("bdPreset").addEventListener("change", applyPreset);
  // Every field the presets cover re-decides which preset (if any) the form now describes — see
  // syncPresetSelection. The two that also change the form's SHAPE keep doing that first.
  $("bdLedType").addEventListener("change", () => { syncBoardFields(); syncPresetSelection(); });
  $("bdBtnPin").addEventListener("change", () => { syncBoardFields(); syncPresetSelection(); });
  for (const id of ["bdLedPin", "bdLedInv", "bdBtnInv"])
    $(id).addEventListener("change", syncPresetSelection);
  $("boardForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const type = +$("bdLedType").value;
    // Belt-and-braces beside boardPinOptions' fallback: an empty select (a device that offered no
    // local pins at all) must read as "no indicator", never as GPIO0 — `+""` is 0, and 0 is a real
    // pin number the request path then has to reject. -1 is the honest answer for "nothing to pick".
    const pinOf = (id) => { const v = parseInt($(id).value, 10); return Number.isFinite(v) ? v : -1; };
    saveReboot("/set_board", {
      preset_id: $("bdPreset").value || "custom",
      // Type "None" is the wire's led_gpio = -1; the pin select keeps its last value so re-enabling
      // the indicator doesn't make the user find their pin again.
      led_gpio: type < 0 ? -1 : pinOf("bdLedPin"),
      led_type: type < 0 ? 0 : type,
      led_inverted: $("bdLedInv").checked,
      btn_gpio: pinOf("bdBtnPin"),
      btn_active_low: $("bdBtnInv").checked,
    }, {
      btn: "bdBtn",
      showError: (msg) => { $("bdError").textContent = msg; $("bdError").hidden = false; },
      close: closeBoard,
      then: renderApp,
      busyMsg: t("toast.saving_board"),
    });
  });

  $("envCancel").onclick = closeEnv3;
  $("env3Backdrop").onclick = closeEnv3;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("env3Modal").hidden) closeEnv3(); });
  $("envSensor").addEventListener("change", () => { syncEnv3Fields(); $("envError").hidden = true; });
  for (const id of ["envSda", "envScl"])
    $(id).addEventListener("change", () => { $("envError").hidden = true; });
  $("env3Form").addEventListener("submit", (e) => {
    e.preventDefault();
    const body = env3FormPayload();
    if (body.enabled && (!Number.isInteger(body.sda) || !Number.isInteger(body.scl) || body.sda === body.scl)) {
      $("envError").textContent = t("env.err_pins"); $("envError").hidden = false;
      toast(t("env.err_pins"), "err"); return;
    }
    saveReboot("/set_env3", body, {
      btn: "envBtn",
      showError: (msg) => { $("envError").textContent = msg; $("envError").hidden = false; },
      close: closeEnv3,
      then: renderApp,
      busyMsg: t("env.checking"),
      busyLabel: "env.checking",
      mapError: env3SaveError,
    });
  });
}

// ── Live data: POLLING, and deliberately not a push ─────────────────────────────────────────────
// This used to be a /events WebSocket. It was removed, and the reasoning is worth having here
// because the pull to "make it live again" will come back (docs/ARCHITECTURE.md "Push vs. poll"):
// a push fails SILENTLY and GLOBALLY — one queue message dropped by IDF froze the status stream
// until the next reboot with nothing logged and values still flowing (#238), and running the push
// from the poll task put the ~3.5 kB /status builder on the task that owns the X10A UART, which
// overflowed its stack (#241). A poll fails LOUDLY and LOCALLY: one request, one visible error,
// retried on the next tick. Nothing about the dashboard needed the socket.
//
// Two cadences, ONE chain. /values (~6 kB) every 2 s feeds the drawing and the value rows; /status
// (~3.5 kB) every 8 s carries the slow half — model, health, heap, uptime, OTA, the banners. Both
// numbers are the transport's, not the plant's: the poll engine still reads the bus at 1 Hz and the
// schematic's motion is CSS, so this is how fast the SCREEN catches up, not how fast we measure.
//
// The chain is a recursive setTimeout and never setInterval: a slow answer has to delay the next
// request, not queue a second one behind it on a device with a single HTTP worker.
const POLL_VALUES_MS      = 2000;
const POLL_STATUS_MS      = 8000;
const POLL_BACKOFF_MAX_MS = 30000;
// Each poll fetch is BOUNDED, and that is not a nicety. `j()` sets no timeout, so a link that drops
// SILENTLY — no RST, no FIN: the ghost association wifi.cpp's ICMP watchdog exists for — leaves
// fetch waiting on the browser's own default, tens of seconds. For all of it the chain is held by
// _pollBusy, markUnreachable() never runs, and the drawing keeps presenting the last poll as the
// plant's current state. That is the one thing DESIGN.md §5.3 forbids, and it fails by ABSENCE:
// nothing on screen looks wrong. 6 s is 3x the values cadence; a device on a LAN answers /values in
// well under one. Deliberately NOT inside j() — /set_mqtt's pre-flight legitimately blocks ~8 s.
const POLL_TIMEOUT_MS     = 6000;
let _pollTimer = null;
let _pollFails = 0;
let _pollBusy  = false;
let _statusDue = 0;        // performance.now() instant the next /status is due (0 = right now)

// An abort signal that fires after `ms`, or undefined where AbortController is missing (then the
// browser's default bound applies — the same fallback the OTA reboot-watcher takes). The bound is a
// parameter because rebootPoll wants a SHORTER one: its probes are aimed at a board that is still
// down, where a long wait is the normal case rather than the pathological one.
function pollSignal(ms = POLL_TIMEOUT_MS) {
  if (!("AbortController" in window)) return undefined;
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);   // a settled request aborts to nothing
  return c.signal;
}

// Every scheduling path goes through here, and it CLEARS first. That is what makes "one chain" true
// rather than hopeful: pollNow() and a tick finishing can both schedule, and the last one to run
// leaves exactly one timer standing.
function pollSchedule(ms) {
  clearTimeout(_pollTimer);
  _pollTimer = setTimeout(pollTick, ms);
}

async function pollTick() {
  _pollTimer = null;
  // Nobody is looking. Skip the requests and re-check at the normal cadence — the tick itself is
  // kept alive (a few clamped, empty timer wake-ups) rather than stopping the chain, because a
  // chain that only restarts on an event is dead for good if that event never arrives.
  if (document.hidden) { pollSchedule(POLL_VALUES_MS); return; }
  // A tick already in flight: never two /values builds queued on one HTTP worker.
  if (_pollBusy) { pollSchedule(POLL_VALUES_MS); return; }

  _pollBusy = true;
  let ok = true;
  try {
    const now = performance.now();
    if (now >= _statusDue) {
      ok = await refreshStatus();                  // its own failure path shows the banner
      if (ok) _statusDue = now + POLL_STATUS_MS;
    }
    // /status just failed => the device is unreachable; a second doomed request per tick only
    // doubles the wait for the timeout that decides the backoff.
    if (ok) ok = await refreshValues();
  } finally {
    _pollBusy = false;
  }

  _pollFails = ok ? 0 : Math.min(_pollFails + 1, 4);
  pollSchedule(_pollFails ? Math.min(POLL_VALUES_MS * 2 ** _pollFails, POLL_BACKOFF_MAX_MS)
                          : POLL_VALUES_MS);
}

// Poll right now, status included, and let the chain carry on from there. Used on the first tick
// and whenever the tab becomes visible: coming back must not leave the numbers from whenever the
// tab was last on screen sitting there looking current. It also drops the backoff — a reboot the
// user waited out should not be answered with a 30 s wait.
function pollNow() {
  _statusDue = 0;
  _pollFails = 0;
  pollSchedule(0);
}

function pollStart() {
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pollNow(); });
  pollNow();
}

// Stop the chain. The one caller is the GIF recorder (tools/uigif/scenes.js), which needs a STILL
// page: it pauses every CSS animation at a deterministic instant, and a poll landing after that
// could rebuild an element and hand it a fresh, unpaused one — a frame at a random animation phase,
// which is exactly the defect the recorder's whole-cycle arithmetic exists to avoid.
function pollStop() {
  clearTimeout(_pollTimer);
  _pollTimer = null;
}

async function boot() {
  applyStaticI18n();       // localise the static index.html markup (data-i18n) before the first render
  labelSchematicHits();    // name the clickable schematic parts from the INSPECT table
  wire();
  initNavigation();        // restore dashboard / Settings / exact popup from the address + history
  resumeOta();             // adopt a download already running (reload mid-update / second tab)

  pollStart();             // the live data: /status + /values on a timer (there is no push)
}
boot();
