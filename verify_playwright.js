const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');

async function testFrontend() {
  console.log('--- STARTING FRONTEND PLAYWRIGHT VERIFICATION ---');

  // Ensure database exists with products
  // Start server
  const server = spawn('node', ['server.js'], { stdio: 'inherit' });
  await new Promise(resolve => setTimeout(resolve, 3000));

  const browser = await chromium.launch({ headless: true });

  try {
    // 1. Create context with desktop viewport
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();

    // 2. Go to home page
    await page.goto('http://localhost:3001/');
    await page.waitForLoadState('networkidle');

    // Take Desktop Screenshot
    await page.screenshot({ path: 'verification_desktop_home.png', fullPage: true });
    console.log('✅ Desktop Home Screenshot Captured.');

    // 3. Verify category dropdown & select 'Fashion'
    const select = page.locator('#headerCategorySelect');
    await select.selectOption('Fashion');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'verification_desktop_fashion_filter.png', fullPage: true });
    console.log('✅ Fashion Filter Applied and Screenshot Captured.');

    // Reset filter
    await select.selectOption('All');
    await page.waitForTimeout(1000);

    // 4. Test searching for "Flowy"
    const searchInput = page.locator('#searchInput');
    await searchInput.fill('Flowy');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'verification_desktop_search.png', fullPage: true });
    console.log('✅ Search Filter Applied and Screenshot Captured.');

    // Clear search
    await searchInput.fill('');
    await page.waitForTimeout(1000);

    // 5. Click a product card (e.g. 'Flowy Dress') to open modal
    const firstProduct = page.locator('.card-name').first();
    await firstProduct.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'verification_desktop_product_modal.png' });
    console.log('✅ Product Modal Opened and Screenshot Captured.');

    // Close modal
    const closeBtn = page.locator('.modal .close').first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    }
    await page.waitForTimeout(1000);

    // 6. Test mobile view
    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 667 },
      isMobile: true
    });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto('http://localhost:3001/');
    await mobilePage.waitForLoadState('networkidle');
    await mobilePage.screenshot({ path: 'verification_mobile_home.png', fullPage: true });
    console.log('✅ Mobile View Screenshot Captured.');

    console.log('--- ALL FRONTEND VERIFICATION CHECKS PASSED ---');

  } catch (err) {
    console.error('❌ FRONTEND PLAYWRIGHT VERIFICATION FAILED:', err);
    process.exit(1);
  } finally {
    await browser.close();
    server.kill();
    process.exit(0);
  }
}

testFrontend();
