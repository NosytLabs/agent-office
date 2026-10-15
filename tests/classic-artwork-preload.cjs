/* Compatibility suite: preserve the original-pixel contract. The studio
 * integration suite runs separately, without this test-only browser setup.
 */
const { chromium } = require("playwright");
function preferClassic() {
  try {
    for (const surface of ["observer", "preview"])
      localStorage.setItem(
        "agent-office:studio:v1:" + surface,
        JSON.stringify({ art: "classic" }),
      );
  } catch {
    // Some tests deliberately deny browser storage. Do not mask that behavior.
  }
}
const launch = chromium.launch.bind(chromium);
chromium.launch = async (...args) => {
  const browser = await launch(...args);
  const newContext = browser.newContext.bind(browser);
  const newPage = browser.newPage.bind(browser);
  browser.newContext = async (...options) => {
    const context = await newContext(...options);
    await context.addInitScript(preferClassic);
    return context;
  };
  browser.newPage = async (...options) => {
    const page = await newPage(...options);
    await page.addInitScript(preferClassic);
    return page;
  };
  return browser;
};
