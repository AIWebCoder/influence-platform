const SessionManager = require('./SessionManager');
const Humanizer = require('./Humanizer');
const { getPool } = require('../core/database');
const fs = require('fs');
const path = require('path');
const os = require('os');

class InstagramBot {
  /**
   * Automates the publishing of a post/story/reel on Instagram using Playwright.
   * @param {string} accountId 
   * @param {Object} contentPacket 
   */
  async publishContent(accountId, contentPacket) {
    let context;
    const pool = getPool();
    try {
      context = await SessionManager.initializeSession(accountId);
      const page = await context.newPage();

      console.log(`[Bot] Navigating to Instagram for account ${accountId}...`);
      await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle' });

      // Check if logged in (for Phase 2 real tests we check session/login)
      const isLoggedIn = await page.locator('svg[aria-label="New post"]').count() > 0;
      if (!isLoggedIn) {
         console.log(`[Bot] WARNING: ${accountId} is not logged in. Session may have expired or credentials needed.`);
         // Here we would typically trigger a login flow utilizing AccountService to get credentials
         // await this.login(page, username, password)
      }

      console.log(`[Bot] Simulating human browsing behavior...`);
      await Humanizer.humanScroll(page);
      
      console.log(`[Bot] Initializing post creation flow...`);
      
      await Humanizer.randomDelay(1000, 2000);
      
      // Click New Post '+' indicator
      await page.click('svg[aria-label="New post"]');
      await page.waitForSelector('text="Select from computer"', { state: 'visible', timeout: 5000 });

      console.log(`[Bot] Uploading visual for packet ${contentPacket.id}...`);
      
      // Download visual to temp file
      let tempFilePath;
      try {
        const visualUrl = contentPacket.visual_url || 'https://via.placeholder.com/800';
        const response = await fetch(visualUrl);
        const buffer = await response.arrayBuffer();
        tempFilePath = path.join(os.tmpdir(), `upload_${contentPacket.id}_${Date.now()}.jpg`);
        fs.writeFileSync(tempFilePath, Buffer.from(buffer));

        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser'),
          page.click('text="Select from computer"')
        ]);
        await fileChooser.setFiles(tempFilePath);
      } finally {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          // fs.unlinkSync(tempFilePath); // Cleanup after a delay or immediately
        }
      }

      await Humanizer.randomDelay(1000, 2000);

      // Click Next after upload
      await page.click('div[role="button"]:has-text("Next")');
      await Humanizer.randomDelay(1000, 2000);
      await page.click('div[role="button"]:has-text("Next")'); // filters

      // Type the AI Caption
      console.log(`[Bot] Writing caption...`);
      const fullCaption = `${contentPacket.caption}\n\n${(contentPacket.hashtags || []).map(tag => typeof tag === 'string' && tag.startsWith('#') ? tag : '#' + tag).join(' ')}`;
      await page.waitForSelector('div[aria-label="Write a caption..."]');
      await Humanizer.humanType(page, 'div[aria-label="Write a caption..."]', fullCaption);
      
      await Humanizer.randomDelay(2000, 4000);

      // Click Share
      console.log(`[Bot] Sharing post...`);
      await page.click('div[role="button"]:has-text("Share")');
      await page.waitForSelector('text="Your post has been shared."', { timeout: 15000 });

      console.log(`[Bot] Post successfully published for ${accountId}!`);
      
      await page.close();
      
      await pool.query("UPDATE content_packets SET status = 'published' WHERE id = $1", [contentPacket.id]);
      
      // Return a simulated URL 
      return `https://instagram.com/p/live_${contentPacket.id.substring(0,8)}/`;
      
    } catch (error) {
      console.error(`[Bot Error] Pub failed for ${accountId}:`, error);
      try {
        await pool.query("UPDATE content_packets SET status = 'failed' WHERE id = $1", [contentPacket.id]);
      } catch (dbErr) {
        console.error("Failed to update db status on error", dbErr);
      }
      throw error;
    }
  }
}

module.exports = new InstagramBot();
