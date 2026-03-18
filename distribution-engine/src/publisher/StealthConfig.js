const puppeteerExtraPluginStealth = require('puppeteer-extra-plugin-stealth');

function getStealthPlugin() {
  const stealth = puppeteerExtraPluginStealth();
  
  // Customizing stealth evasion logic if needed
  // For Instagram, standard stealth usually covers:
  // - navigator.webdriver = false
  // - window.chrome = {}
  // - Object.defineProperty overrides
  
  // Note: some evasions might conflict with mobile emulation or specific Chromium versions
  // We can toggle down plugins here if they cause crashes
  stealth.enabledEvasions.delete('user-agent-override'); // Playwright context usually handles UA better for mobile emulation
  
  return stealth;
}

module.exports = { getStealthPlugin };
