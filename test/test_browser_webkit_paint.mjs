import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function assertWebKitFlowPaint(page, context) {
  await page.evaluate("document.getElementById('fSup1').scrollIntoView({block:'center',behavior:'instant'}); true");
  await page.waitFor("!S.clickHold && !S.scrub && !_pollBusy");
  const frozen = process.env.DAIKIN_BROWSER_MUTATION === "history-paint-freeze";
  const initial = await page.evaluate(`(() => {
    const node=document.getElementById('fSup1');
    const animation=node.getAnimations().find(item=>item instanceof CSSAnimation);
    const rect=node.getBoundingClientRect();
    window.__webkitPaint={node,animation,time:animation?.currentTime,polls:window.__motionAllPolls,
      wall:performance.now(),frames:0};
    const sample=()=>{window.__webkitPaint.frames++;window.__webkitPaint.request=requestAnimationFrame(sample);};
    window.__webkitPaint.request=requestAnimationFrame(sample);
    return {running:animation?.playState==='running',x:rect.left,y:rect.top,width:rect.width};
  })()`);
  assert.equal(initial.running, true, context + ": painted flow must have a running CSSAnimation");
  assert.ok(initial.width >= 12, context + ": flow crop must resolve multiple actual pixels");
  if (frozen) await page.evaluate("document.getElementById('fSup1').style.setProperty('stroke-dashoffset','0','important'); true");
  // Only an interior segment of this single horizontal flow stroke is captured. Text, rotors,
  // adjacent branches and changing readouts cannot make a frozen line pass the paint witness.
  const clip = { x: Math.ceil(initial.x + initial.width * 0.15), y: Math.floor(initial.y - 3),
    width: Math.floor(initial.width * 0.7), height: 6 };
  const hashes = [];
  try {
    for (const interval of [0, 613, 743, 587, 829, 677, 911, 557]) {
      if (interval) await delay(interval);
      const png = await page.screenshotClip(clip);
      hashes.push(createHash("sha256").update(png).digest("hex"));
    }
    const final = await page.evaluate(`(() => {
      const {node,animation,time,polls,wall,frames}=window.__webkitPaint;
      return {same:node.getAnimations().includes(animation),running:animation?.playState==='running',
        elapsed:animation?.currentTime-time,polls:window.__motionAllPolls-polls,wall:performance.now()-wall,frames,
        visible:document.visibilityState};
    })()`);
    assert.equal(final.same && final.running, true, context + ": visual witness must retain its running animation");
    // Sparse native snapshot capture does not sample WebKit's presentation clock at the same
    // cadence as the uninterrupted rAF/input observation below. Bound this paint witness by real
    // elapsed browser time and HTTP polls; the shared matrix separately enforces clock continuity
    // and the unchanged 250 ms frame/input limits without screenshots disturbing that observation.
    assert.ok(final.wall >= 4500 && final.elapsed > 0 && final.frames > 0 && final.polls >= 2,
      context + ": visual paint witness must span real time, advancing animation and production polling; " + JSON.stringify(final));
    assert.ok(new Set(hashes).size >= 3,
      context + ": WebKit painted flow must change across native screenshots while its animation clock advances");
    console.log("WebKit flow paint checked: " + context + "; " + new Set(hashes).size +
      " distinct tight flow crops; " + final.polls + " real polls; " + Math.round(final.wall) + " ms");
  } finally {
    if (frozen) await page.evaluate("document.getElementById('fSup1').style.removeProperty('stroke-dashoffset'); true");
    await page.evaluate("cancelAnimationFrame(window.__webkitPaint.request); delete window.__webkitPaint; true");
  }
}
