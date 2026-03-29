const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const screenshotsDir = 'screenshots';
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir);
  }

  // Helper to wait and screenshot
  async function takeScreenshot(name) {
    await page.waitForTimeout(2000); // Wait for animations/loads
    await page.screenshot({ path: path.join(screenshotsDir, `${name}.png`), fullPage: true });
    console.log(`Screenshot taken: ${name}.png`);
  }

  try {
    // 1. Customer Frontend
    console.log('Verifying Customer Frontend...');
    await page.goto('http://localhost:3000/');
    await takeScreenshot('customer_home');

    // 2. Vendor Backend Login
    console.log('Verifying Vendor Backend...');
    await page.goto('http://localhost:3000/backend.html');
    await takeScreenshot('vendor_login');

    // 3. Admin Portal Login
    console.log('Verifying Admin Portal...');
    await page.goto('http://localhost:3000/admin.html');
    await takeScreenshot('admin_login');

  } catch (error) {
    console.error('Error during verification:', error);
  } finally {
    await browser.close();
  }
})();
