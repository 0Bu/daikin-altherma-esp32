import assert from "node:assert/strict";

const evaluate = (page, fn, arg) => page.evaluate(`(${fn})(${JSON.stringify(arg)})`);

async function point(page, selector, offsetPx = null) {
  const hit = await evaluate(page, async ({ selector, offsetPx }) => {
    const node = document.querySelector(selector);
    node?.scrollIntoView({ block: "center", behavior: "instant" });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const box = node?.getBoundingClientRect();
    if (!box?.width || !box.height) throw new Error("missing visible fault target: " + selector);
    const x = offsetPx == null ? box.left + box.width * 0.5 : box.left + offsetPx;
    const y = box.top + box.height * 0.5;
    const hitEl = document.elementFromPoint(x, y);
    return { x, y, matched: !!hitEl?.closest(selector), hitTag: hitEl?.outerHTML?.slice(0, 120) || "",
      width: box.width, height: box.height, left: box.left, right: box.right };
  }, { selector, offsetPx });
  assert.equal(hit.matched, true, `fault target not hit-testable: ${selector} -> ${JSON.stringify(hit)}`);
  return hit;
}

export async function assertFaultChart(page, context, viewportName) {
  const unixEnd = 1791900000;
  const fixtureCheck = {
    id: "fault", verdict: "warn", evidence: "manufacturer", active: 1, observed_s: 82000,
    latest: {
      code: "7H-01", base_code: "7H", subcode: 1, state: "fault", unit: "outdoor",
      ongoing: true, stop_unknown: false, age_s: 0, duration_s: 600,
      start_unix_s: unixEnd - 600, secondary_code: "U4", secondary_state: "warning",
    },
    timeline: {
      unix_s: unixEnd, window_end_s: 86400, observed_end_s: 86400, boot_s: 86400, live: true,
      segments: [
        { t: 0, k: "gap" },
        { t: 10000, k: "ok" },
        { t: 18000, k: "err", c: "E5", b: "E5", u: "outdoor" },
        { t: 18010, k: "ok" }, // 10 s short spike -> tests min-width: 3px
        { t: 42000, k: "warn", c: "U4", b: "U4", u: "indoor" },
        { t: 43200, k: "ok" },
        { t: 85800, k: "err", c: "7H-01", b: "7H", sub: 1, u: "outdoor", sc: "U4", sk: "warn" },
      ],
    },
  };

  await page.evaluate(`(() => {
    window.__faultOriginal = {
      status: S.status, open: new Set(S.descOpen), card: S.dashboardCard,
      faultCodes: new Set(S.faultCodes), faultSnapKeys: S.faultSnapKeys ? new Set(S.faultSnapKeys) : null,
    };
    S.status = structuredClone(S.status);
    S.status.diagnostics = { ...(S.status.diagnostics || {}), enabled: true, source: "x10a", effective_source: "x10a" };
    S.status.ntp = { ...(S.status.ntp || {}), synced: true, time: ${unixEnd} };
    S.status.health = {
      status: "warn", source: "x10a", source_fresh: true, full_span: true, span_s: 86400,
      persist: "fresh", checks: [${JSON.stringify(fixtureCheck)}],
    };
    S.descOpen.clear();
    S.faultCodes.clear();
    S.faultSnapKeys = null;
    S.faultHoverIdx = null;
    S.dashboardCard = "diagnosis";
    showStage("dashboard");
    renderApp();
    return true;
  })()`);

  try {
    await page.frame();
    // Collapsed row: active shows `7H-01 · ...`, no duplicated -01-01.
    const collapsed = await page.evaluate(`(() => {
      const btn = document.querySelector("[data-desc='model:health_fault']");
      const val = btn?.querySelector(".vrow-val")?.innerText || "";
      return { val, expanded: btn?.getAttribute("aria-expanded") };
    })()`);
    assert.ok(collapsed.val.startsWith("7H-01 · ") && !collapsed.val.includes("7H-01-01"),
      `${context}: active collapsed fault must show code + duration without duplicating subcode: ${collapsed.val}`);

    // Expand accordion via real click and wait for CSS height transition + clickHold to settle.
    const rowPos = await point(page, "[data-desc='model:health_fault']");
    await page.nativeClick(rowPos.x, rowPos.y);
    await page.waitFor(`document.querySelector("[data-desc='model:health_fault']")?.getAttribute("aria-expanded") === "true" && !S.clickHold`);
    await page.frame();

    // Verify order, hidden default table, distinct colors, >= 3px min-width on 10s spike, and zero Normal: block.
    const initial = await page.evaluate(`(() => {
      const item = document.querySelector("[data-desc='model:health_fault']").closest(".vitem");
      const body = item.querySelector(".vdesc-body");
      const wrap = body.querySelector(".checkup-fault-table-wrap");
      const okSeg = body.querySelector(".vhist-state-ok");
      const gapSeg = body.querySelector(".vhist-state-gap");
      const segs = Array.from(body.querySelectorAll("[data-fault-seg]"));
      const colors = segs.map(s => getComputedStyle(s).backgroundColor);
      const shortSpike = segs.find(s => s.dataset.faultCode === "E5")?.getBoundingClientRect().width || 0;
      const panel = body.querySelector("[data-checkup-fault]");
      const rows = Array.from(body.querySelectorAll("tbody tr")).map(r => r.dataset.faultCode);
      const children = Array.from(panel.children).map(el => el.className);
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      return {
        children,
        tableHidden: !!wrap?.hidden,
        okBg: okSeg ? getComputedStyle(okSeg).backgroundColor : "",
        gapBgImg: gapSeg ? getComputedStyle(gapSeg).backgroundImage : "",
        colors,
        shortSpike,
        rows,
        text: body.innerText,
        overflow,
      };
    })()`);

    assert.equal(initial.overflow <= 0, true, `${context}: fault expander overflows (${initial.overflow}px)`);
    assert.equal(initial.tableHidden, true, `${context}: fault event table must stay hidden by default`);
    assert.ok(!initial.text.includes("Normal:"), `${context}: fault explainer must not show Normal:`);
    assert.ok(initial.children[0].includes("checkup-fault-hero"), `${context}: hero must come first`);
    assert.ok(initial.children[1].includes("checkup-fault-chart"), `${context}: chart must follow hero`);
    assert.ok(initial.children[2].includes("checkup-fault-table-wrap"), `${context}: table wrapper follows chart`);
    assert.ok(initial.children[3].includes("vdesc-p"), `${context}: what paragraph comes last`);
    assert.ok(initial.shortSpike >= 3, `${context}: 10s fault pill must render >= 3px wide (${initial.shortSpike}px)`);
    assert.equal(new Set(initial.colors).size, 3, `${context}: distinct fault codes must have distinct pill colors`);
    assert.ok(!initial.colors.includes(initial.okBg), `${context}: fault colors must differ from grey ok`);
    assert.ok(initial.gapBgImg && initial.gapBgImg !== "none", `${context}: gap must render diagonal hatch`);
    assert.deepEqual(initial.rows, ["7H-01", "U4", "E5"], `${context}: table rows must sort newest-first`);

    // 1. Multi-select chip toggles open table & filter visible rows.
    const chipU4 = await point(page, 'button.fault-chip[data-fault-chip="U4"]');
    await page.nativeClick(chipU4.x, chipU4.y);
    await page.frame();
    const afterU4 = await page.evaluate(`(() => {
      const btn = document.querySelector('button.fault-chip[data-fault-chip="U4"]');
      const wrap = document.querySelector(".checkup-fault-table-wrap");
      const visible = Array.from(wrap.querySelectorAll("tbody tr")).filter(r => !r.hidden).map(r => r.dataset.faultCode);
      const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const cellClip = Array.from(wrap.querySelectorAll("th, td")).some(c => c.scrollWidth > c.clientWidth + 2);
      return { pressed: btn?.getAttribute("aria-pressed"), tableHidden: !!wrap?.hidden, visible, docOverflow, cellClip };
    })()`);
    assert.equal(afterU4.pressed, "true");
    assert.equal(afterU4.tableHidden, false, `${context}: active chip must reveal table`);
    assert.deepEqual(afterU4.visible, ["U4"]);
    assert.ok(afterU4.docOverflow <= 0, `${context}/${viewportName}: table must not overflow viewport (${afterU4.docOverflow}px)`);
    assert.equal(afterU4.cellClip, false, `${context}/${viewportName}: table cells must wrap without clipping`);

    // Toggle second chip -> both visible (multi-select).
    const chip7H = await point(page, 'button.fault-chip[data-fault-chip="7H-01"]');
    await page.nativeClick(chip7H.x, chip7H.y);
    await page.frame();
    const afterBoth = await page.evaluate(`Array.from(document.querySelectorAll(".checkup-fault-table tbody tr"))
      .filter(r => !r.hidden).map(r => r.dataset.faultCode)`);
    assert.deepEqual(afterBoth, ["7H-01", "U4"]);

    // Turn off both chips -> table hides again.
    const chipU4Off = await point(page, 'button.fault-chip[data-fault-chip="U4"]');
    await page.nativeClick(chipU4Off.x, chipU4Off.y);
    await page.frame();
    const chip7HOff = await point(page, 'button.fault-chip[data-fault-chip="7H-01"]');
    await page.nativeClick(chip7HOff.x, chip7HOff.y);
    await page.frame();
    assert.equal(await page.evaluate(`!!document.querySelector(".checkup-fault-table-wrap")?.hidden`), true,
      `${context}: clearing all chips hides table again`);

    // 2. +-20px magnetic bar tap near E5 spike (~10s wide at 18000s / 86400s = 20.8%).
    const barSnap = await page.evaluate(`(async () => {
      const track = document.querySelector(".checkup-fault-track");
      track?.scrollIntoView({ block: "center", behavior: "instant" });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const seg = track.querySelector('[data-fault-code="E5"]');
      const tb = track.getBoundingClientRect();
      const sb = seg.getBoundingClientRect();
      const nearX = Math.min(tb.right - 2, sb.left + 8); // 8px from segment (within +-20px!)
      const farOkX = tb.left + tb.width * 0.72; // deep in ok span (~62200s, >20px from U4/7H-01)
      return { nearX, farOkX, y: tb.top + tb.height * 0.5 };
    })()`);
    await page.nativeClick(barSnap.nearX, barSnap.y);
    await page.frame();
    const afterSnap = await page.evaluate(`(() => {
      const wrap = document.querySelector(".checkup-fault-table-wrap");
      const visible = Array.from(wrap.querySelectorAll("tbody tr")).filter(r => !r.hidden).map(r => r.dataset.faultCode);
      const snapped = wrap.querySelector("tbody tr.is-snapped")?.dataset.faultCode || "";
      return { tableHidden: !!wrap.hidden, visible, snapped };
    })()`);
    assert.equal(afterSnap.tableHidden, false, `${context}: bar tap within +-20px must reveal table`);
    assert.deepEqual(afterSnap.visible, ["E5"]);
    assert.equal(afterSnap.snapped, "E5");

    // Tap >20px away in ok span -> clears bar snap and hides table!
    await page.nativeClick(barSnap.farOkX, barSnap.y);
    await page.frame();
    assert.equal(await page.evaluate(`!!document.querySelector(".checkup-fault-table-wrap")?.hidden`), true,
      `${context}: clicking ok span >20px from any fault pill must clear bar snap and hide table`);

    // 3. Collapsed healthy state -> empty .vrow-val (display:none) + non-empty aria-label.
    await page.waitFor("!S.clickHold");
    await page.evaluate(`(() => {
      S.status.health = {
        status: "ok", source: "x10a", source_fresh: true, full_span: true, span_s: 86400,
        persist: "fresh", checks: [{ id: "fault", verdict: "ok", evidence: "manufacturer", active: 0, observed_s: 86400 }],
      };
      S.descOpen.clear();
      renderApp();
      return true;
    })()`);
    await page.frame();
    const okRow = await page.evaluate(`(() => {
      const btn = document.querySelector("[data-desc='model:health_fault']");
      const val = btn.querySelector(".vrow-val");
      return {
        text: val.textContent,
        display: getComputedStyle(val).display,
        aria: btn.getAttribute("aria-label") || "",
      };
    })()`);
    assert.equal(okRow.text, "");
    assert.equal(okRow.display, "none", `${context}: empty healthy fault value must hide .vrow-val`);
    assert.ok(okRow.aria.includes(await page.evaluate(`t("check.fault_none")`)),
      `${context}: healthy fault row must preserve accessible state label (${okRow.aria})`);
  } finally {
    await page.evaluate(`(() => {
      const o = window.__faultOriginal;
      if (o) {
        S.status = o.status;
        S.descOpen = o.open;
        S.dashboardCard = o.card;
        S.faultCodes = o.faultCodes;
        S.faultSnapKeys = o.faultSnapKeys;
        S.clickHold = false;
        delete window.__faultOriginal;
        renderApp();
      }
      return true;
    })()`);
    await page.frame();
  }
}
