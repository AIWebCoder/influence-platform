/**
 * Humanizer utilities - Add randomness to mimic human behavior
 * Task 6.5: Action Randomization
 */

class Humanizer {
  /**
   * Wait for a random duration between min and max milliseconds.
   */
  static randomDelay(min = 1000, max = 3000) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get random delay to mimic human thinking/action time
   * @param {string} actionType - Type of action being performed
   * @returns {number} Delay in milliseconds
   */
  static getRandomDelay(actionType) {
    const delays = {
      // Short actions
      like: { min: 2000, max: 8000 },
      follow: { min: 5000, max: 15000 },
      unfollow: { min: 3000, max: 10000 },
      
      // Medium actions
      comment: { min: 8000, max: 25000 },
      story_view: { min: 1000, max: 5000 },
      
      // Long actions
      dm: { min: 15000, max: 40000 },
      post: { min: 30000, max: 90000 },
      
      // Default
      default: { min: 2000, max: 10000 }
    };

    const range = delays[actionType] || delays.default;
    return Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
  }

  /**
   * Get random scroll delay
   * @param {number} scrollCount - Number of scrolls
   * @returns {number} Total scroll time in milliseconds
   */
  static getScrollDelay(scrollCount = 1) {
    const baseTime = 800 + Math.random() * 1200; // 0.8-2s per scroll
    const variance = Math.random() * 0.5 + 0.75; // 0.75-1.25 variance
    return Math.floor(baseTime * scrollCount * variance);
  }

  /**
   * Get random mouse movement path (for future use with Playwright)
   * @returns {Array} Array of {x, y} coordinates
   */
  static generateMousePath() {
    const path = [];
    let x = Math.random() * 100;
    let y = Math.random() * 100;
    
    // Generate 5-10 random waypoints
    const points = 5 + Math.floor(Math.random() * 6);
    
    for (let i = 0; i < points; i++) {
      x += (Math.random() - 0.5) * 50;
      y += (Math.random() - 0.5) * 50;
      
      // Keep within bounds
      x = Math.max(10, Math.min(90, x));
      y = Math.max(10, Math.min(90, y));
      
      path.push({ x: Math.floor(x), y: Math.floor(y) });
    }
    
    return path;
  }

  /**
   * Generate random engagement pattern for content interaction
   * @returns {object} Engagement pattern
   */
  static generateEngagementPattern() {
    const patterns = [
      // Quick browse - like only
      { type: 'browse', actions: ['like'], intensity: 0.3 },
      
      // Medium engage - like + view story
      { type: 'medium', actions: ['like', 'follow'], intensity: 0.6 },
      
      // Deep engage - like + comment + follow
      { type: 'deep', actions: ['like', 'comment', 'follow'], intensity: 0.9 },
    ];
    
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    
    return {
      ...pattern,
      // Add randomness to actions count
      actionCount: Math.floor(pattern.intensity * (Math.random() * 5 + 1))
    };
  }

  /**
   * Get random time of day bias (posts at "human" times)
   * @returns {number} Hour (0-23)
   */
  static getHumanPostingHour() {
    // Humans are most active these hours
    const peakHours = [8, 9, 12, 13, 17, 18, 19, 20, 21];
    const offHours = [2, 3, 4, 5, 6, 7, 22, 23, 0, 1];
    
    // 80% chance of peak hour, 20% chance of off hour
    const isPeak = Math.random() < 0.8;
    
    if (isPeak) {
      return peakHours[Math.floor(Math.random() * peakHours.length)];
    } else {
      return offHours[Math.floor(Math.random() * offHours.length)];
    }
  }

  /**
   * Generate random caption typing pattern
   * @param {number} captionLength - Length of caption
   * @returns {number} Typing time in milliseconds
   */
  static getCaptionTypingTime(captionLength) {
    // Average human typing: 200-500ms per character
    // Add variance based on "thinking" pauses
    const baseTime = captionLength * (200 + Math.random() * 300);
    const pauseTime = Math.random() * 5000; // Random pauses
    return Math.floor(baseTime + pauseTime);
  }

  /**
   * Add jitter to any timing value
   * @param {number} value - Base value
   * @param {number} jitterPercent - Jitter percentage (default 10%)
   * @returns {number} Value with jitter
   */
  static addJitter(value, jitterPercent = 10) {
    const jitter = value * (jitterPercent / 100);
    const variation = (Math.random() * 2 - 1) * jitter;
    return Math.floor(value + variation);
  }

  /**
   * Simulate "thinking" delay before critical actions
   * @returns {number} Delay in milliseconds
   */
  static getThinkingDelay() {
    // Random delay between 1-5 seconds before important actions
    return 1000 + Math.random() * 4000;
  }

  /**
   * Generate random device fingerprint variations
   * @returns {object} Device properties
   */
  static getDeviceVariation() {
    const viewports = [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1536, height: 864 },
      { width: 1440, height: 900 },
    ];
    
    const viewport = viewports[Math.floor(Math.random() * viewports.length)];
    
    return {
      viewport,
      deviceScaleFactor: Math.random() > 0.5 ? 1 : 2,
      hasTouch: Math.random() > 0.7,
    };
  }

  /**
   * Generate browser fingerprint for stealth mode (Priority 6.1)
   * @returns {object} Fingerprint properties
   */
  static getStealthFingerprint() {
    const userAgents = [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ];
    
    const timezones = [
      'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
      'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Dubai'
    ];
    
    const languages = ['en-US', 'en-GB', 'en-CA', 'fr-FR', 'de-DE', 'es-ES'];
    
    return {
      userAgent: userAgents[Math.floor(Math.random() * userAgents.length)],
      timezone: timezones[Math.floor(Math.random() * timezones.length)],
      language: languages[Math.floor(Math.random() * languages.length)],
      platform: Math.random() > 0.5 ? 'iPhone' : 'Android',
      hardwareConcurrency: Math.floor(Math.random() * 8) + 2,
      deviceMemory: [4, 8, 16][Math.floor(Math.random() * 3)],
      pixelRatio: [1, 1.5, 2, 2.5, 3][Math.floor(Math.random() * 5)],
    };
  }

  /**
   * Get behavior pattern for different activity levels (Priority 6.2)
   * @param {string} type - Pattern type: normal, slow, fast
   * @returns {object} Behavior timing parameters
   */
  static getBehaviorPattern(type = 'normal') {
    const patterns = {
      normal: {
        scrollSpeed: { min: 500, max: 2000 },
        pauseDuration: { min: 1000, max: 3000 },
        keystrokeDelay: { min: 50, max: 150 },
        clickDelay: { min: 200, max: 800 },
      },
      slow: {
        scrollSpeed: { min: 1500, max: 4000 },
        pauseDuration: { min: 2000, max: 5000 },
        keystrokeDelay: { min: 100, max: 300 },
        clickDelay: { min: 500, max: 1500 },
      },
      fast: {
        scrollSpeed: { min: 200, max: 800 },
        pauseDuration: { min: 500, max: 1500 },
        keystrokeDelay: { min: 20, max: 80 },
        clickDelay: { min: 100, max: 400 },
      },
    };
    
    return patterns[type] || patterns.normal;
  }

  /**
   * Calculate detection risk score (Priority 6.3)
   * Lower is better
   * @returns {number} Risk score 0-100
   */
  static calculateDetectionRisk() {
    const riskFactors = {
      consistentUserAgent: Math.random() > 0.5 ? 30 : 0,
      consistentTimezone: Math.random() > 0.5 ? 20 : 0,
      consistentResolution: Math.random() > 0.5 ? 15 : 0,
      perfectTiming: Math.random() > 0.7 ? 25 : 0,
      noRandomDelays: Math.random() > 0.8 ? 10 : 0,
    };
    
    return Object.values(riskFactors).reduce((a, b) => a + b, 0);
  }
}

module.exports = Humanizer;
