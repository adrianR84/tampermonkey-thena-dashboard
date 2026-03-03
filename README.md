# Thena Dashboard Calculator

A Tampermonkey userscript for the Thena.fi dashboard that calculates earnings and provides alerts.

## Features

- **Earnings Calculator**: Calculates annual, monthly, daily, and hourly earnings based on total amount and APR
- **Real-time Overlay**: Displays earnings in a fixed overlay on the dashboard
- **APR Alerts**: Sends notifications when APR falls below threshold
- **Stats Alerts**: Sends periodic stats messages with total amount, APR, and daily earnings
- **Zero APR Alerts**: Detects positions with 0% APR and sends alerts
- **Minimizable Overlay**: Toggle between detailed and minimal view
- **Secure Storage**: Encrypts sensitive API tokens and settings
- **Multiple Notification Services**: Supports Telegram and Pushbullet

## Settings

Access the settings via Tampermonkey menu command "Thena Settings":

### General Settings
- Enable/Disable Script
- Enable/Disable Console Logs
- APR Threshold (%)
- Alert Interval (minutes)
- Stats Alerts (enable/disable)
- Stats Interval (minutes)

### Notification Services
- **Telegram**: Bot token and chat ID configuration
- **Pushbullet**: Access token configuration

### Alert Configuration
- **APR Threshold Alerts**: Triggered when APR falls below threshold
- **Stats Alerts**: Periodic messages with earnings data
- **Zero APR Alerts**: Detects positions with 0% APR

## Installation

1. Install Tampermonkey browser extension
2. Click on the raw `thena.user.js` file
3. Install the script
4. Visit https://thena.fi/dashboard

## Configuration

1. Open Tampermonkey dashboard
2. Click "Thena Settings" menu command
3. Configure your notification services and thresholds
4. Save settings

## Security

- All sensitive data (API tokens, chat IDs) are encrypted using AES encryption
- Settings are stored locally in your browser
- No data is transmitted to external servers except notification services

## Compatibility

- **Browser**: Chrome, Firefox, Edge, Safari (with Tampermonkey)
- **Website**: https://thena.fi/dashboard*
- **Dependencies**: jQuery, CryptoJS (auto-loaded by script)

## Version History

- **v0.2**: Added stats alerts, zero APR detection, minimize functionality
- **v0.1**: Initial release with basic earnings calculator and APR alerts
