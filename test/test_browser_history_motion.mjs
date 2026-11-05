import assert from "node:assert/strict";

// Keep real polling enabled here: the static locale matrix deliberately stops it. This combines
// the production fetch/render loop, a full paired day of history and running schematic animations.
export async function assertHistoryMotion(page, server, context) {
  const status = await page.evaluate("JSON.parse(JSON.stringify(S.status))");
  const label = "DHW tank temp. (R5T)";
  const rows = [{ id: "dhw_tank", label }];
  status.history = { rows, modbus_rows: rows, env3_rows: [] };
  status.ui.lang = await page.evaluate("LANG");
  let frame = 0;
  const histories = {};
  for (const source of ["x10a", "modbus"]) {
    histories[`${source}:dhw_tank`] = { dt: 300, b0: 100, t0: 1793750000, unit: "°C",
      v: Array.from({ length: 288 }, (_, i) => i % 43 === 0 ? null
        : 450 + Math.round(30 * Math.sin(i / 9)) + (source === "modbus" ? 1 : 0)) };
  }
  server.setTelemetry({ status, histories, values: () => ({ values: [
    { label: "I/U Operation Mode", value: "Heating + DHW" },
    { label: "INV frequency", value: "42", unit: "rps" },
    { label: "Flow sensor", value: "24.5", unit: "l/min" },
    { label: "Leaving water temp. before BUH (R1T)", value: "35", unit: "°C" },
    { label: "Inlet water temp.(R4T)", value: "30", unit: "°C" },
    { label, value: (48 + ++frame / 10).toFixed(1), unit: "°C", concept: "dhw_tank" },
    { label: "3way valve(On:DHW_Off:Space)", value: "1", binary: true, concept: "valve_dhw" },
  ] }) });
  try {
    await page.evaluate(`(() => {
      window.__motionOriginal = { ...S };
      S.hist = new Map(); S.histPin = new Map(); S.histBusy = new Set();
      S.histRequests = new Map(); S.histAwait = new Map(); S.descOpen = new Set();
      S.insp = null; S.inspSig = null; S.inspHistSig = null;
      pollSchedule = window.__browserPollSchedule;
      pollNow();
      return true;
    })()`);
    await page.waitFor("!_pollBusy && S._values.some(row => row.concept === 'dhw_tank')");
    // Dispatch through the actual delegated schematic handler, not inspectPick directly.
    await page.evaluate(`document.querySelector('#schem [data-insp=tank]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true })); true`);
    await page.waitFor("document.querySelector('#inspHist .vhist-multi .vhist-plot') && !S.histBusy.size");
    await page.evaluate(`(() => {
      window.__motionHtml = histHtml;
      window.__motionBuilds = 0;
      histHtml = (...args) => { window.__motionBuilds++; return window.__motionHtml(...args); };
      window.__motionPlot = document.querySelector('#inspHist .vhist-plot');
      window.__motionBody = document.getElementById('inspBody').firstChild;
      window.__motionAnimations = ['fSup1', 'rfHot', 'scFan', 'scPump'].map(id => {
        const node = document.getElementById(id);
        const animation = node.getAnimations().find(a => a instanceof CSSAnimation);
        return { node, animation, time: animation?.currentTime };
      });
      window.__motionFrames = { last: performance.now(), maxGap: 0, count: 0 };
      const sample = now => {
        const f = window.__motionFrames;
        f.maxGap = Math.max(f.maxGap, now - f.last); f.last = now; f.count++;
        f.request = requestAnimationFrame(sample);
      };
      window.__motionFrames.request = requestAnimationFrame(sample);
      return true;
    })()`);
    const before = server.valuesRequests;
    // Three real two-second ticks with changing values; no manually advanced animation clock.
    await page.waitFor(`!_pollBusy && Number(S._values.find(row => row.concept === 'dhw_tank').value)
      >= ${48 + (frame + 3) / 10}`, { timeoutMs: 10000 });
    assert.ok(server.valuesRequests >= before + 3, `${context}: at least three real values polls`);
    const motion = await page.evaluate(`(() => ({
      builds: window.__motionBuilds,
      hiddenCharts: document.querySelectorAll('#valueGroups .vitem:not(.open) .vhist, #settingsCards .vitem:not(.open) .vhist').length,
      samePlot: window.__motionPlot === document.querySelector('#inspHist .vhist-plot'),
      sameBody: window.__motionBody === document.getElementById('inspBody').firstChild,
      animations: window.__motionAnimations.map(({node, animation, time}) => ({
        id: node.id, same: node.getAnimations().includes(animation),
        running: animation?.playState === 'running', elapsed: animation?.currentTime - time,
      })),
      frames: window.__motionFrames.count, maxFrameGap: window.__motionFrames.maxGap,
    }))()`);
    assert.equal(motion.builds, 0, `${context}: polls must not rebuild cached charts in closed rows`);
    assert.equal(motion.hiddenCharts, 0, `${context}: closed rows must not parse duplicate history SVGs`);
    assert.equal(motion.samePlot, true, `${context}: unchanged inspector plot must remain mounted`);
    assert.equal(motion.sameBody, true, `${context}: changed numbers must preserve unchanged inspector prose`);
    for (const animation of motion.animations) {
      assert.equal(animation.same && animation.running, true, `${context}/${animation.id}: preserve running animation`);
      assert.ok(animation.elapsed >= 4000, `${context}/${animation.id}: animation must advance during real polling`);
    }
    assert.ok(motion.frames > 3, `${context}: frames must render between values polls`);

    // A cached history must appear immediately when its value row is opened. No fresh fetch or
    // later poll may be needed to fill a chart deliberately omitted from collapsed markup.
    const requestsBeforeDisclosure = server.historyRequests.length;
    await page.evaluate(`(() => {
      selectDashboardCard('group:Domestic hot water');
      document.querySelector('#valueGroups [data-trend=dhw_tank]').click();
      return true;
    })()`);
    assert.equal(await page.evaluate("!!document.querySelector('#valueGroups .vitem.open .vhist-plot')"),
      true, `${context}: cached chart must mount during the disclosure action`);
    await page.waitFor("!S.histBusy.size");
    assert.equal(server.historyRequests.length, requestsBeforeDisclosure,
      `${context}: cached disclosure must not refetch history`);
    await page.evaluate("renderCards(); true");
    assert.equal(await page.evaluate("!!document.querySelector('#valueGroups .vitem.open .vhist-plot')"),
      true, `${context}: an expanded chart survives the next render`);
    await page.evaluate(`document.querySelector('#valueGroups [data-trend=dhw_tank]').click();
      renderCards(); true`);
    assert.equal(await page.evaluate("document.querySelectorAll('#valueGroups .vhist').length"),
      0, `${context}: a closed row releases its chart on the next render`);
    assert.equal(await page.evaluate(`(() => {
      const source = document.getElementById('inspSrc').textContent;
      inspectPick('env3');
      const envSource = document.getElementById('inspSrc').textContent;
      inspectPick('tank');
      return envSource === 'ENV III' && document.getElementById('inspSrc').textContent === source;
    })()`), true, `${context}: ENV III roundtrip must restore the tank source label`);
    assert.deepEqual(page.diagnostics, [], `${context}: polling and disclosure must emit no browser errors`);
    console.log(`history motion checked: ${context}; 3 live polls; no hidden chart rebuilds; ` +
      `max frame gap ${Math.round(motion.maxFrameGap)} ms`);
  } finally {
    await page.evaluate("pollStop(); pollSchedule = () => {}; true");
    await page.waitFor("!_pollBusy && !S.histBusy.size");
    server.setTelemetry();
    await page.evaluate(`(() => {
      if (window.__motionFrames) cancelAnimationFrame(window.__motionFrames.request);
      if (window.__motionHtml) histHtml = window.__motionHtml;
      Object.assign(S, window.__motionOriginal);
      S.inspSig = null; S.inspHistSig = null;
      renderApp();
      for (const key of ['Original', 'Html', 'Builds', 'Plot', 'Body', 'Animations', 'Frames']) delete window['__motion' + key];
      return true;
    })()`);
    await page.waitFor(`document.getElementById('inspect').getAnimations({subtree: true})
      .every(animation => animation.playState !== 'running')`);
  }
}
