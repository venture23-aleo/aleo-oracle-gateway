# Discord Notifications Setup

This guide explains how to set up Discord notifications for the Aleo Oracle system to receive alerts about errors, cron job status, and service events using **rich embeds** for better visual presentation.

## Prerequisites

- A Discord server where you have permission to create webhooks
- The Aleo Oracle system running

## Setup Steps

### 1. Create a Discord Webhook

1. **Open Discord** and navigate to your server
2. **Go to Server Settings** (click the server name → Server Settings)
3. **Navigate to Integrations** → **Webhooks**
4. **Click "New Webhook"**
5. **Configure the webhook:**
   - **Name:** `Aleo Oracle Alerts` (or any name you prefer)
   - **Channel:** Select the channel where you want to receive notifications
   - **Copy the Webhook URL** (you'll need this for the next step)

### 2. Configure Environment Variable

Add the Discord webhook URL to your environment variables:

```bash
# Add to your .env file
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN
```

Or set it as an environment variable:

```bash
export DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN
```

### 3. Test the Setup

Start the server and check if Discord notifications are working:

```bash
npm start
```

You should see a message in the logs indicating whether Discord notifications are enabled or disabled.

## Types of Rich Embed Notifications

The system sends the following types of Discord notifications using rich embeds:

### 🚨 Error Alerts

- **When:** Any error occurs in the system
- **Color:** Red (#FF0000)
- **Includes:** Error message, stack trace, and context information in organized fields
- **Example:** Oracle service initialization failures, API errors, etc.

### ✅ Cron Job Alerts

- **When:** Cron jobs start, complete, or fail
- **Colors:**
  - 🔄 Started: Blue (#0099FF)
  - ✅ Success: Green (#00FF00)
  - ❌ Failed: Red (#FF0000)
- **Includes:** Job name, status, duration, and any errors in organized fields
- **Example:** Price update cycles, scheduled tasks

### 🟢 Service Status Alerts

- **When:** Services come online or go offline
- **Colors:**
  - 🟢 Online: Green (#00FF00)
  - 🔴 Offline: Red (#FF0000)
  - 🟡 Warning: Orange (#FFA500)
- **Includes:** Service name, status, and additional details in organized fields
- **Example:** API server startup/shutdown, Oracle service status

### 💰 Price Update Alerts

- **When:** Coin price updates succeed or fail
- **Colors:**
  - 💰 Success: Green (#00FF00)
  - 💸 Failed: Red (#FF0000)
- **Includes:** Coin name, price (if successful), and error details
- **Example:** BTC, ETH, ALEO price updates

### 🔗 Transaction Alerts

- **When:** Blockchain transactions succeed or fail
- **Colors:**
  - ✅ Success: Green (#00FF00)
  - ❌ Failed: Red (#FF0000)
- **Includes:** Coin name, transaction ID, price, and additional details
- **Example:** SGX data updates on Aleo blockchain

### 🏥 System Health Alerts

- **When:** System health monitoring reports
- **Colors:**
  - 🟢 Healthy: Green (#00FF00)
  - 🟡 Warning: Orange (#FFA500)
- **Includes:** Uptime, memory usage, CPU usage, and status
- **Example:** Periodic health checks

## Rich Embed Features

All notifications use Discord's rich embed format with:

- **Color-coded borders** for quick visual identification
- **Organized fields** for better readability
- **Timestamps** for precise event tracking
- **Footers** with system identification
- **Emojis** for visual appeal
- **Code blocks** for technical details
- **Inline fields** for compact information display

## Configuration Options

### Disable Notifications

To disable Discord notifications, simply don't set the `DISCORD_WEBHOOK_URL` environment variable.

### Custom Webhook URL

You can also pass a custom webhook URL when creating the DiscordNotifier instance:

```javascript
import { DiscordNotifier } from './src/utils/discordNotifier.js';

const customNotifier = new DiscordNotifier('YOUR_CUSTOM_WEBHOOK_URL');
```

## Troubleshooting

### Notifications Not Sending

1. **Check the webhook URL** - Make sure it's correct and the webhook is still active
2. **Verify permissions** - Ensure the webhook has permission to send messages to the channel
3. **Check logs** - Look for "Discord notification sent successfully" or error messages in the logs

### Too Many Notifications

If you're receiving too many notifications, you can:

1. **Filter by notification type** - The system uses different emojis for different types
2. **Create a separate channel** for different notification types
3. **Modify the notification logic** in the code to reduce frequency

### Webhook Rate Limits

Discord webhooks have rate limits. If you're hitting them:

- The system will log failed notification attempts
- Consider reducing the frequency of notifications
- Use multiple webhooks for different notification types

## Security Considerations

- **Keep webhook URLs private** - Don't commit them to version control
- **Use environment variables** - Store webhook URLs in `.env` files
- **Regular rotation** - Consider rotating webhook URLs periodically
- **Monitor usage** - Keep an eye on webhook usage to detect abuse

## Example Rich Embed Notifications

### Error Alert (Red Embed)

```
🚨 Aleo Oracle Error Alert
[Red border]

❌ Error
```

Failed to connect to Oracle service

```

📋 Stack Trace
```

Error: Connection timeout
at OracleService.initialize (/app/src/services/oracleService.js:55:12)
at async /app/server.js:45:1

````

🔍 Context
```json
{
  "operation": "initialize",
  "coins": ["BTC", "ETH", "ALEO"]
}
````

Footer: Aleo Oracle System

```

### Cron Job Success (Green Embed)
```

✅ Cron Job Completed Successfully: price_update
[Green border]

📊 Status: SUCCESS
⏱️ Duration: 45000ms

Footer: Aleo Oracle Cron System

```

### Service Online (Green Embed)
```

🟢 Service Status Alert
[Green border]

🔧 Service: API Server
📊 Status: ONLINE
📋 Details:
**host:** 0.0.0.0
**port:** 3000
**environment:** production

Footer: Aleo Oracle Monitoring

```

### Transaction Success (Green Embed)
```

✅ Transaction Successful
[Green border]

🪙 Coin: BTC
📊 Status: SUCCESS
🔗 Transaction ID: `at1qh6jrtkm3kalkkx04y5e4rxuula8tr2xj956hsf67n6jeqwvtupsw7s2sd`
📋 Details:
**price:** 43250.50
**requestHash:** abc123...
**timestamp:** 2025-07-15T22:30:00.000Z

Footer: Aleo Oracle Transaction Monitor

```

### System Health (Green Embed)
```

🏥 System Health Report
[Green border]

📊 Status: HEALTHY
⏱️ Uptime: 2h 15m
💾 Memory Usage: 245MB / 1024MB
🖥️ CPU Usage: 12.5%

Footer: Aleo Oracle Health Monitor

```

```
