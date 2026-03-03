// ==UserScript==
// @name         Thena Dashboard Calculator
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Calculate earnings and APY on Thena dashboard with alerts
// @author       Cascade
// @match        https://thena.fi/dashboard*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      api.telegram.org
// @connect      api.pushbullet.com
// @require      https://code.jquery.com/jquery-3.7.1.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js
// ==/UserScript==

(function () {
  "use strict";

  // ========== CONSTANTS & CONFIGURATION ==========
  const STORAGE_KEYS = {
    SETTINGS: "thena_settings",
  };

  const DEFAULT_SETTINGS = {
    // Sensitive settings will be loaded separately and encrypted
    BOT_TOKEN: "", // Will be loaded from encrypted storage
    CHAT_ID: "", // Will be loaded from encrypted storage
    PUSHBULLET_ACCESS_TOKEN: "", // Will be loaded from encrypted storage
    APR_THRESHOLD: 5, // APR threshold in percent
    ALERT_INTERVAL: 60, // Alert interval in minutes
    TELEGRAM_ENABLED: false,
    PUSHBULLET_ENABLED: false,
    SCRIPT_ENABLED: true,
    CONSOLE_LOGS_ENABLED: true,
    STATS_ENABLED: false,
    STATS_INTERVAL: 60, // Stats alert interval in minutes
    STATS_TELEGRAM_ENABLED: false,
    STATS_PUSHBULLET_ENABLED: false,
    LAST_ALERT_TIME: 0,
    LAST_STATS_TIME: 0,
  };

  let SETTINGS = { ...DEFAULT_SETTINGS };

  // Destructure settings for easier access
  let {
    BOT_TOKEN,
    CHAT_ID,
    PUSHBULLET_ACCESS_TOKEN,
    APR_THRESHOLD,
    ALERT_INTERVAL,
    TELEGRAM_ENABLED,
    PUSHBULLET_ENABLED,
    SCRIPT_ENABLED,
    CONSOLE_LOGS_ENABLED,
    STATS_ENABLED,
    STATS_INTERVAL,
    STATS_TELEGRAM_ENABLED,
    STATS_PUSHBULLET_ENABLED,
    LAST_ALERT_TIME: lastAlertTime,
    LAST_STATS_TIME: lastStatsTime,
  } = SETTINGS;

  let isOverlayMinimized = true;

  // ========== HELPER FUNCTIONS ==========

  function getNumbersFromElements() {
    const trs = document.querySelectorAll("tr");
    const numbers = [];
    trs.forEach((tr) => {
      const td = tr.querySelector("td.flex.flex-col.max-xl\\:flex-1");
      if (td) {
        const span = td.querySelector("span:first-child");
        if (span) {
          const text = span.textContent.trim();
          const number = parseFloat(text.replace(/[^\d.-]/g, ""));
          if (!isNaN(number)) {
            numbers.push(number);
          }
        }
      }
    });
    return numbers;
  }

  function log(message, type = "info") {
    if (CONSOLE_LOGS_ENABLED) {
      switch (type) {
        case "error":
          console.error(message);
          break;
        case "warn":
          console.warn(message);
          break;
        case "success":
          console.log(`✅ ${message}`);
          break;
        default:
          console.log(message);
      }
    }
  }

  function updateDestructuredSettings() {
    ({
      BOT_TOKEN,
      CHAT_ID,
      PUSHBULLET_ACCESS_TOKEN,
      APR_THRESHOLD,
      ALERT_INTERVAL,
      TELEGRAM_ENABLED,
      PUSHBULLET_ENABLED,
      SCRIPT_ENABLED,
      CONSOLE_LOGS_ENABLED,
      STATS_ENABLED,
      STATS_INTERVAL,
      STATS_TELEGRAM_ENABLED,
      STATS_PUSHBULLET_ENABLED,
      LAST_ALERT_TIME: lastAlertTime,
      LAST_STATS_TIME: lastStatsTime,
    } = SETTINGS);
  }

  // ========== NOTIFICATION FUNCTIONS ==========

  function sendTelegramMessage(message) {
    if (!SCRIPT_ENABLED) {
      log("⏸️ Script is disabled - Telegram message not sent", "warn");
      return;
    }

    if (!message || typeof message !== "string") {
      log("❌ Invalid message content", "error");
      return;
    }

    const data = {
      chat_id: CHAT_ID,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    };

    GM_xmlhttpRequest({
      method: "POST",
      url: `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(data),
      timeout: 10000,
      onload: (response) => {
        if (response.status === 200) {
          log("✅ Telegram sent: " + new Date().toLocaleTimeString());
        } else {
          log("❌ Telegram error: " + response.status, "error");
        }
      },
      onerror: (error) => {
        log("❌ Telegram request failed: " + error.message, "error");
      },
      ontimeout: () => {
        log("❌ Telegram request timeout", "error");
      },
    });
  }

  function sendPushbulletMessage(title, message) {
    if (!SCRIPT_ENABLED) {
      log("⏸️ Script is disabled - Pushbullet message not sent", "warn");
      return;
    }

    if (!PUSHBULLET_ACCESS_TOKEN) {
      log("Pushbullet access token not configured", "error");
      return;
    }

    // Strip HTML tags for Pushbullet
    const plainTextMessage = message
      .replace(/<[^>]*>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n+/g, "\n")
      .trim();

    GM_xmlhttpRequest({
      method: "POST",
      url: "https://api.pushbullet.com/v2/pushes",
      headers: {
        "Content-Type": "application/json",
        "Access-Token": PUSHBULLET_ACCESS_TOKEN,
      },
      data: JSON.stringify({
        type: "note",
        title: title,
        body: plainTextMessage,
      }),
      onload: function (response) {
        if (response.status >= 200 && response.status < 300) {
          log("✅ Pushbullet notification sent successfully");
        } else {
          log(
            "❌ Failed to send Pushbullet notification: " +
              response.responseText,
            "error",
          );
        }
      },
      onerror: function (error) {
        log("❌ Pushbullet API error: " + error, "error");
      },
    });
  }

  // ========== SECURE SETTINGS FUNCTIONS ==========

  function getEncryptionKey() {
    if (typeof localStorage !== "undefined") {
      const storedKey = localStorage.getItem("thena_encryption_key");
      if (storedKey) {
        return storedKey;
      }
    }
    const userKey = `thena_${navigator.userAgent.substring(0, 10)}_${Date.now()}`;
    localStorage.setItem("thena_encryption_key", userKey);
    return userKey;
  }

  function encryptSensitiveData(data) {
    try {
      const key = getEncryptionKey();
      return CryptoJS.AES.encrypt(JSON.stringify(data), key).toString();
    } catch (error) {
      log("Encryption failed:", error, "error");
      return null;
    }
  }

  function decryptSensitiveData(encrypted) {
    try {
      const key = getEncryptionKey();
      const bytes = CryptoJS.AES.decrypt(encrypted, key);
      return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
    } catch (error) {
      log("Decryption failed:", error, "error");
      return null;
    }
  }

  function saveSecureSettings() {
    try {
      const sensitiveData = {
        BOT_TOKEN: SETTINGS.BOT_TOKEN,
        CHAT_ID: SETTINGS.CHAT_ID,
        PUSHBULLET_ACCESS_TOKEN: SETTINGS.PUSHBULLET_ACCESS_TOKEN,
      };
      const nonSensitiveData = {
        ...SETTINGS,
        BOT_TOKEN: undefined,
        CHAT_ID: undefined,
        PUSHBULLET_ACCESS_TOKEN: undefined,
      };
      const encrypted = encryptSensitiveData(sensitiveData);
      if (encrypted) {
        GM_setValue("sensitive_settings", encrypted);
      }
      GM_setValue("settings", nonSensitiveData);
      log("✅ Settings saved securely");
    } catch (error) {
      log("❌ Error saving secure settings:", error, "error");
    }
  }

  function loadSecureSettings() {
    try {
      const nonSensitiveData = GM_getValue("settings", {});
      SETTINGS = { ...DEFAULT_SETTINGS, ...nonSensitiveData };
      const encrypted = GM_getValue("sensitive_settings", null);
      if (encrypted) {
        const sensitiveData = decryptSensitiveData(encrypted);
        if (sensitiveData) {
          SETTINGS.BOT_TOKEN = sensitiveData.BOT_TOKEN;
          SETTINGS.CHAT_ID = sensitiveData.CHAT_ID;
          SETTINGS.PUSHBULLET_ACCESS_TOKEN =
            sensitiveData.PUSHBULLET_ACCESS_TOKEN;
        }
      }
      updateDestructuredSettings();
      log("✅ Settings loaded securely");
    } catch (error) {
      log("❌ Error loading secure settings:", error, "error");
      resetSettings();
    }
  }

  function resetSettings() {
    SETTINGS = { ...DEFAULT_SETTINGS };
    updateDestructuredSettings();
    saveSecureSettings();
  }

  function updateOverlay() {
    if (!SCRIPT_ENABLED) {
      const existing = document.querySelector(".thena-calculator");
      if (existing) existing.remove();
      return;
    }
    let totalAmountElement = document.querySelector(
      ".font-archia.font-semibold.text-neutral-50.max-md\\:text-primary-300.flex.gap-4.text-3xl.max-md\\:text-center.md\\:text-4xl",
    );
    if (!totalAmountElement) {
      log("Total amount element not found");
      return;
    }
    let totalAmountText =
      totalAmountElement.querySelector("span")?.textContent?.trim() ||
      totalAmountElement.textContent.trim();
    // Remove all non-numeric characters including dollar sign
    let totalAmount = parseFloat(totalAmountText.replace(/[^\d.-]/g, ""));
    if (isNaN(totalAmount)) {
      log("Invalid total amount");
      return;
    }

    // Find APR element
    let aprElement = document.querySelector(
      ".font-archia.text-primary-600.text-xl.font-semibold.md\\:text-\\[40px\\].md\\:leading-\\[40px\\]",
    );
    if (!aprElement) {
      log("APR element not found");
      return;
    }
    let aprText = aprElement.textContent.trim();
    let apr = parseFloat(aprText.replace(/[^\d.-]/g, "")) / 100; // to decimal
    if (isNaN(apr)) {
      log("Invalid APR");
      return;
    }

    // Find claim amount element
    let claimAmountElement = document.querySelector(
      ".font-archia.text-3xl.md\\:text-5xl.text-primary-600.font-semibold.max-md\\:hidden",
    );
    let claimAmount = 0;
    if (claimAmountElement) {
      let claimAmountText = claimAmountElement.textContent.trim();
      claimAmount = parseFloat(claimAmountText.replace(/[^\d.-]/g, ""));
      if (isNaN(claimAmount)) {
        claimAmount = 0;
      }
    }

    // Calculate earnings
    let annualEarnings = totalAmount * apr;
    let monthlyEarnings = annualEarnings / 12;
    let dailyEarnings = annualEarnings / 365;
    let hourlyEarnings = dailyEarnings / 24;

    // Log calculations
    log(
      `Thena Earnings Calculated: Total Amount: $${totalAmount.toLocaleString()}, APR: ${(apr * 100).toFixed(2)}%, Annual: $${annualEarnings.toLocaleString(undefined, { maximumFractionDigits: 4 })}, Monthly: $${monthlyEarnings.toLocaleString(undefined, { maximumFractionDigits: 4 })}, Daily: $${dailyEarnings.toLocaleString(undefined, { maximumFractionDigits: 6 })}, Hourly: $${hourlyEarnings.toLocaleString(undefined, { maximumFractionDigits: 8 })}`,
    );

    // Check for APR alert
    if (
      SCRIPT_ENABLED &&
      Date.now() - lastAlertTime > ALERT_INTERVAL * 60000 &&
      apr * 100 < APR_THRESHOLD
    ) {
      const message = `⚠️ Thena APR Alert: APR has fallen below ${APR_THRESHOLD}%. Current APR: ${(apr * 100).toFixed(2)}%`;
      log(message); // Simulate alert in console
      if (TELEGRAM_ENABLED) {
        sendTelegramMessage(message);
      }
      if (PUSHBULLET_ENABLED) {
        sendPushbulletMessage("Thena APR Alert", message);
      }
      lastAlertTime = SETTINGS.LAST_ALERT_TIME = Date.now();
      saveSecureSettings();
    }

    // Check for stats alert
    if (
      SCRIPT_ENABLED &&
      STATS_ENABLED &&
      Date.now() - lastStatsTime > STATS_INTERVAL * 60000
    ) {
      const plainMessage = `📊 Thena Stats: Total Amount: $${totalAmount.toLocaleString()}, APR: ${(apr * 100).toFixed(2)}%, Daily Earnings: $${dailyEarnings.toLocaleString(undefined, { maximumFractionDigits: 6 })}, Claim Amount: $${claimAmount.toLocaleString()}`;
      const telegramMessage = `📊 **Thena Stats**\n**Total Amount:** $${totalAmount.toLocaleString()}\n**APR:** ${(apr * 100).toFixed(2)}%\n**Daily Earnings:** $${dailyEarnings.toLocaleString(undefined, { maximumFractionDigits: 6 })}\n**Claim Amount:** $${claimAmount.toLocaleString()}`;
      log(plainMessage);
      if (STATS_TELEGRAM_ENABLED) {
        sendTelegramMessage(telegramMessage);
      }
      if (STATS_PUSHBULLET_ENABLED) {
        sendPushbulletMessage("Thena Stats", plainMessage);
      }
      lastStatsTime = SETTINGS.LAST_STATS_TIME = Date.now();
      saveSecureSettings();
    }

    // Check for zero APR positions alert
    const aprValues = getNumbersFromElements();
    if (aprValues.some((apr) => apr === 0)) {
      if (
        SCRIPT_ENABLED &&
        Date.now() - lastAlertTime > ALERT_INTERVAL * 60000
      ) {
        const message = `⚠️ Thena Position Alert: One or more positions have APR of 0%.`;
        log(message);
        if (TELEGRAM_ENABLED) {
          sendTelegramMessage(message);
        }
        if (PUSHBULLET_ENABLED) {
          sendPushbulletMessage("Thena Position Alert", message);
        }
        lastAlertTime = SETTINGS.LAST_ALERT_TIME = Date.now();
        saveSecureSettings();
      }
    }

    // Get or create overlay div
    let overlayDiv = document.querySelector(".thena-calculator");
    if (!overlayDiv) {
      overlayDiv = document.createElement("div");
      overlayDiv.className = "thena-calculator";
      overlayDiv.style.cssText = `
        position: fixed;
        top: 90px;
        right: 40px;
        background: rgba(0, 0, 0, 0.9);
        color: #fff;
        padding: 15px;
        border-radius: 8px;
        z-index: 9999;
        font-size: 16px;
        font-family: Arial, sans-serif;
        box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        max-width: 300px;
      `;
      document.body.appendChild(overlayDiv);
    }

    // Update overlay content
    if (isOverlayMinimized) {
      overlayDiv.innerHTML = `<strong>Thena Earnings Calculator</strong> <button id="maximize-overlay" style="background: #555; color: #fff; border: 1px solid #fff; border-radius: 4px; padding: 2px 6px; cursor: pointer; font-size: 12px; margin-left: 10px;">+</button>`;
    } else {
      overlayDiv.innerHTML = `<strong>Thena Earnings Calculator</strong> <button id="minimize-overlay" style="background: #555; color: #fff; border: 1px solid #fff; border-radius: 4px; padding: 2px 6px; cursor: pointer; font-size: 12px; margin-left: 10px;">-</button><br><br><strong>Earnings (APR ${(apr * 100).toFixed(2)}%):</strong><br>Annual: <b>$${annualEarnings.toLocaleString(undefined, { maximumFractionDigits: 4 })}</b><br>Monthly: <b>$${monthlyEarnings.toLocaleString(undefined, { maximumFractionDigits: 4 })}</b><br>Daily: <b>$${dailyEarnings.toLocaleString(undefined, { maximumFractionDigits: 6 })}</b><br>Hourly: <b>$${hourlyEarnings.toLocaleString(undefined, { maximumFractionDigits: 8 })}</b>`;
    }

    // Add event listeners
    const minimizeBtn = overlayDiv.querySelector("#minimize-overlay");
    if (minimizeBtn) {
      minimizeBtn.addEventListener("click", () => {
        isOverlayMinimized = true;
        updateOverlay();
      });
    }
    const maximizeBtn = overlayDiv.querySelector("#maximize-overlay");
    if (maximizeBtn) {
      maximizeBtn.addEventListener("click", () => {
        isOverlayMinimized = false;
        updateOverlay();
      });
    }
  }

  const STYLES = {
    MODAL_BACKDROP: `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0, 0, 0, 0.8); z-index: 10000;
      display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `,
    MODAL_CONTENT: `
      background: white; padding: 30px; border-radius: 12px;
      max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto;
      box-shadow: 0 20px 40px rgba(0,0,0,0.3);
    `,
    BUTTON_PRIMARY: `
      flex: 1; padding: 12px 20px; background: #007bff; color: white;
      border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer;
    `,
    BUTTON_SECONDARY: `
      padding: 12px 20px; background: #6c757d; color: white;
      border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer;
    `,
    BUTTON_DANGER: `
      padding: 12px 20px; background: #dc3545; color: white;
      border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer;
    `,
  };

  function createModalElement() {
    $("#thena-settings-modal").remove();
    const modal = document.createElement("div");
    modal.id = "thena-settings-modal";
    modal.style.cssText = STYLES.MODAL_BACKDROP;
    const content = document.createElement("div");
    content.style.cssText = STYLES.MODAL_CONTENT;
    content.innerHTML = `
      <h2 style="margin: 0 0 20px 0; color: #000000; font-size: 24px;">⚙️ Thena Calculator Settings</h2>

      <div style="margin-bottom: 20px; padding: 20px; background: #f8f9fa; border-radius: 12px; border: 1px solid #e9ecef;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h3 style="margin: 0; color: #000; font-size: 18px; font-weight: 600;">General Settings</h3>
          <label style="display: flex; align-items: center; cursor: pointer; font-size: 14px; color: #007bff;">
            <input type="checkbox" id="script-enabled" ${SETTINGS.SCRIPT_ENABLED ? "checked" : ""} 
                   style="margin-right: 8px;">
            <span style="color: #000;">🔘 Enable Script</span>
          </label>
        </div>

        <div style="display: flex; align-items: center; margin-bottom: 25px;">
          <label style="display: flex; align-items: center; cursor: pointer; font-size: 14px;">
            <input type="checkbox" id="console-logs-enabled" ${SETTINGS.CONSOLE_LOGS_ENABLED ? "checked" : ""} 
                   style="margin-right: 8px;">
            <span style="color: #000;">Enable Console Logs</span>
          </label>
        </div>


        <div style="margin-top: 15px; display: flex; gap: 20px;">
        <label style="display: flex; align-items: center; cursor: pointer; font-size: 14px;">
            <input type="checkbox" id="telegram-enabled" ${SETTINGS.TELEGRAM_ENABLED ? "checked" : ""} 
                    style="margin-right: 8px;">
            <span style="color: #000;">Enable Telegram Alerts</span>
        </label>

        <label style="display: flex; align-items: center; cursor: pointer; font-size: 14px;">
            <input type="checkbox" id="pushbullet-enabled" ${SETTINGS.PUSHBULLET_ENABLED ? "checked" : ""} 
                    style="margin-right: 8px;">
            <span style="color: #000;">Enable Pushbullet Alerts</span>
        </label>
        </div>

        <div style="margin-bottom: 10px; margin-top: 15px;">
          <label style="display: block; margin-bottom: 5px; font-size: 14px; color: #000;">Alert Interval (minutes):</label>
          <input type="number" id="alert-interval" value="${SETTINGS.ALERT_INTERVAL}" min="1" max="1440"
                 style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; color: #000;">
          <small style="color: #666; font-size: 12px; display: block; margin-top: 5px;">How often to send alerts (in minutes)</small>
        </div>

        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 5px; font-size: 14px; color: #000;">APR Threshold (%):</label>
          <input type="number" id="apr-threshold" value="${SETTINGS.APR_THRESHOLD}" min="0" max="100" step="0.1"
                 style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; color: #000;">
          <small style="color: #666; font-size: 12px; display: block; margin-top: 5px;">Send alerts when APR falls below this percentage</small>
        </div>

        <div style="margin-bottom: 20px; padding: 15px; background: #e8f5e8; border-radius: 8px; border: 1px solid #c3e6c3;">
          <h4 style="margin: 0 0 10px 0; color: #000; font-size: 16px;">📊 Stats Alerts</h4>
          <div style="margin-bottom: 10px;">
            <label style="display: flex; align-items: center; cursor: pointer; font-size: 14px;">
              <input type="checkbox" id="stats-enabled" ${SETTINGS.STATS_ENABLED ? "checked" : ""} 
                     style="margin-right: 8px;">
              <span style="color: #000;">Enable Stats Alerts</span>
            </label>
          </div>
          <div style="margin-bottom: 10px;">
            <label style="display: block; margin-bottom: 5px; font-size: 14px; color: #000;">Stats Interval (minutes):</label>
            <input type="number" id="stats-interval" value="${SETTINGS.STATS_INTERVAL}" min="1" max="1440"
                   style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; color: #000;">
            <small style="color: #666; font-size: 12px; display: block; margin-top: 5px;">How often to send stats messages</small>
          </div>
          <div style="display: flex; gap: 20px;">
            <label style="display: flex; align-items: center; cursor: pointer; font-size: 14px;">
              <input type="checkbox" id="stats-telegram-enabled" ${SETTINGS.STATS_TELEGRAM_ENABLED ? "checked" : ""} 
                     style="margin-right: 8px;">
              <span style="color: #000;">Telegram</span>
            </label>
            <label style="display: flex; align-items: center; cursor: pointer; font-size: 14px;">
              <input type="checkbox" id="stats-pushbullet-enabled" ${SETTINGS.STATS_PUSHBULLET_ENABLED ? "checked" : ""} 
                     style="margin-right: 8px;">
              <span style="color: #000;">Pushbullet</span>
            </label>
          </div>
        </div>

      </div>

      <div style="margin-bottom: 20px; padding: 20px; background: #fff3cd; border-radius: 12px; border: 1px solid #ffeaa7;">
        <h3 style="margin: 0 0 15px 0; color: #856404; font-size: 18px; font-weight: 600;">🔐 API Configuration</h3>

        <div style="margin-bottom: 20px;">
          <h4 style="margin: 0 0 10px 0; color: #000; font-size: 16px; font-weight: 600;">📱 Telegram Bot Settings</h4>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
            <div>
              <label style="display: block; margin-bottom: 5px; font-size: 14px; color: #000;">Bot Token:</label>
              <input type="password" id="bot-token" value="${SETTINGS.BOT_TOKEN}" 
                    placeholder="Enter Telegram Bot Token" 
                    style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; color: #000;">
              <small style="color: #666; font-size: 11px; display: block; margin-top: 3px;">Get from @BotFather on Telegram</small>
            </div>
            <div>
              <label style="display: block; margin-bottom: 5px; font-size: 14px; color: #000;">Chat ID:</label>
              <input type="text" id="chat-id" value="${SETTINGS.CHAT_ID}" 
                    placeholder="Enter Chat ID" 
                    style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; color: #000;">
              <small style="color: #666; font-size: 11px; display: block; margin-top: 3px;">Your Telegram chat ID</small>
            </div>
          </div>
        </div>

        <div style="margin-bottom: 20px;">
          <h4 style="margin: 0 0 10px 0; color: #000; font-size: 16px; font-weight: 600;">🔔 Pushbullet Settings</h4>
          <div>
            <label style="display: block; margin-bottom: 5px; font-size: 14px; color: #000;">Access Token:</label>
            <input type="password" id="pushbullet-token" value="${SETTINGS.PUSHBULLET_ACCESS_TOKEN}" 
                  placeholder="Enter Pushbullet Access Token" 
                  style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; color: #000;">
            <small style="color: #666; font-size: 11px; display: block; margin-top: 3px;">Get from Pushbullet account settings</small>
          </div>
        </div>
      </div>

      <div style="display: flex; gap: 10px; justify-content: flex-end;">
        <button id="reset-settings" style="${STYLES.BUTTON_SECONDARY}">Reset to Defaults</button>
        <button id="save-settings" style="${STYLES.BUTTON_PRIMARY}">Save Settings</button>
        <button id="close-modal" style="${STYLES.BUTTON_DANGER}">Close</button>
      </div>
    `;
    modal.appendChild(content);
    document.body.appendChild(modal);

    $("#save-settings").on("click", saveSettingsFromModal);
    $("#reset-settings").on("click", resetSettingsFromModal);
    $("#close-modal").on("click", () => modal.remove());
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  function saveSettingsFromModal() {
    SETTINGS.SCRIPT_ENABLED = $("#script-enabled").prop("checked");
    SETTINGS.CONSOLE_LOGS_ENABLED = $("#console-logs-enabled").prop("checked");
    SETTINGS.APR_THRESHOLD = parseFloat($("#apr-threshold").val()) || 5;
    SETTINGS.ALERT_INTERVAL = parseFloat($("#alert-interval").val()) || 60;
    SETTINGS.STATS_ENABLED = $("#stats-enabled").prop("checked");
    SETTINGS.STATS_INTERVAL = parseFloat($("#stats-interval").val()) || 60;
    SETTINGS.STATS_TELEGRAM_ENABLED = $("#stats-telegram-enabled").prop(
      "checked",
    );
    SETTINGS.STATS_PUSHBULLET_ENABLED = $("#stats-pushbullet-enabled").prop(
      "checked",
    );
    SETTINGS.BOT_TOKEN = $("#bot-token").val().trim();
    SETTINGS.CHAT_ID = $("#chat-id").val().trim();
    SETTINGS.TELEGRAM_ENABLED = $("#telegram-enabled").prop("checked");
    SETTINGS.PUSHBULLET_ACCESS_TOKEN = $("#pushbullet-token").val().trim();
    SETTINGS.PUSHBULLET_ENABLED = $("#pushbullet-enabled").prop("checked");
    saveSecureSettings();
    updateDestructuredSettings();
    updateOverlay(); // Apply changes immediately
    log("Settings saved from modal");
    $("#thena-settings-modal").remove();
  }

  function resetSettingsFromModal() {
    if (confirm("Are you sure you want to reset all settings to defaults?")) {
      resetSettings();
      log("Settings reset to defaults");
      $("#thena-settings-modal").remove();
      setTimeout(createModalElement, 100);
    }
  }

  // Run on load
  loadSecureSettings();
  GM_registerMenuCommand("Thena Settings", createModalElement);
  window.addEventListener("load", function () {
    setInterval(updateOverlay, 10000);
  });
})();
