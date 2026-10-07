// Run this callback with an owned Electron Puppeteer page via tab.run.
// Frame contents are captured from the real app; no UI state or results are mocked.
export async function recordDesktop({ page }, data, workflow) {
  const fs = await import('node:fs/promises');
  const cdp = await page.createCDPSession();
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await fs.mkdir(data.frames, { recursive: true });
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const screenshot = async () => {
    let timer;
    try {
      return await Promise.race([
        cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Real app screenshot exceeded 15 seconds')), 15000); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const button = async name => {
    const handle = await page.evaluateHandle(name => Array.from(document.querySelectorAll('button')).find(button => button.innerText.replace(/\s+/g, ' ').trim() === name || button.title === name || button.getAttribute('aria-label') === name), name);
    const element = handle.asElement();
    if (!element) throw new Error(`Button not found: ${name}`);
    await element.evaluate(button => button.click());
    await handle.dispose();
  };
  const input = async (selector, value) => {
    await page.focus(selector);
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.type(value, { delay: 18 });
  };
  const evaluate = async expression => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result.value;
  };
  const until = async (expression, test, timeout = 60000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = await evaluate(expression);
      if (test(value)) return value;
      await pause(250);
    }
    throw new Error(`Timed out waiting for actual app state: ${expression}`);
  };
  const started = Date.now();
  const times = [];
  let active = true;
  let count = 0;
  let captureError;
  const capture = (async () => {
    try {
      while (active) {
        const frameStarted = Date.now();
        const shot = await screenshot();
        await fs.writeFile(`${data.frames}/${String(count++).padStart(5, '0')}.png`, Buffer.from(shot.data, 'base64'));
        times.push(Date.now() - started);
        await pause(Math.max(0, 250 - (Date.now() - frameStarted)));
      }
    } catch (error) {
      captureError = error;
    }
  })();
  let evidence;
  let completed = false;
  try {
    await pause(900);
    evidence = await workflow({ page, button, input, evaluate, until, pause }, data);
    await pause(1500);
    completed = true;
    return evidence;
  } finally {
    active = false;
    await capture;
    await fs.writeFile(`${data.frames}/capture.json`, JSON.stringify({ id: data.id, source: data.source, completed, frames: count, times, elapsed: Date.now() - started, evidence, captureError: captureError?.message }, null, 2));
    await cdp.detach();
    if (captureError) throw captureError;
  }
}
