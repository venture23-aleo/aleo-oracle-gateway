import axios from 'axios';
import { log, logError } from './logger.js';
import { discordConfig } from '../config/index.js';

interface DiscordEmbed {
  title: string;
  color: number;
  timestamp: string;
  fields: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  footer?: {
    text: string;
  };
}

/**
 * Discord notifier
 * @class DiscordNotifier
 */
class DiscordNotifier {
  private webhookUrl: string | undefined;
  private enableTransactionAlert: boolean;
  private enablePriceUpdateAlert: boolean;
  private enableCronJobAlert: boolean;
  private enableServiceStatusAlert: boolean;
  private enableSystemHealthAlert: boolean;
  private enableErrorAlert: boolean;

  constructor() {
    this.webhookUrl = discordConfig.webhookUrl;
    this.enableTransactionAlert = discordConfig.enableTransactionAlert;
    this.enablePriceUpdateAlert = discordConfig.enablePriceUpdateAlert;
    this.enableCronJobAlert = discordConfig.enableCronJobAlert;
    this.enableServiceStatusAlert = discordConfig.enableServiceStatusAlert;
    this.enableSystemHealthAlert = discordConfig.enableSystemHealthAlert;
    this.enableErrorAlert = discordConfig.enableErrorAlert;
  }

  async sendEmbed(embed: Record<string, any>): Promise<boolean> {
    if (!this.webhookUrl) {
      return false;
    }

    try {
      const payload = {
        embeds: [embed],
      };

      const response = await axios.post(this.webhookUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });

      if (response.status === 204) {
        log('Discord embed notification sent successfully');
        return true;
      } else {
        logError('Discord embed notification failed', new Error(`HTTP ${response.status}`));
        return false;
      }
    } catch (error) {
      logError('Failed to send Discord embed notification', error as Error);
      return false;
    }
  }

  async sendErrorAlert(error: Error, context: Record<string, any> = {}): Promise<boolean> {
    if (!this.enableErrorAlert) return false;

    const timestamp = new Date().toISOString();
    const errorMessage = error.message || 'Unknown error';
    const errorStack = error.stack
      ? error.stack.split('\n').slice(0, 5).join('\n')
      : 'No stack trace';

    const embed: DiscordEmbed = {
      title: '🚨 Aleo Oracle Error Alert',
      color: 0xff0000, // Red
      timestamp,
      fields: [
        {
          name: '❌ Error',
          value: `\`\`\`${errorMessage}\`\`\``,
          inline: false,
        },
        {
          name: '📋 Stack Trace',
          value: `\`\`\`${errorStack}\`\`\``,
          inline: false,
        },
      ],
      footer: {
        text: 'Aleo Oracle System',
      },
    };

    // Add context fields if available
    if (Object.keys(context).length > 0) {
      embed.fields.push({
        name: '🔍 Context',
        value: `\`\`\`json\n${JSON.stringify(context, null, 2)}\`\`\``,
        inline: false,
      });
    }

    return await this.sendEmbed(embed);
  }

  async sendCronJobAlert(
    jobName: string,
    status: 'success' | 'failed' | 'started' | string,
    error: Error | null = null,
    duration: number | null = null
  ): Promise<boolean> {
    if (!this.enableCronJobAlert) return false;

    const timestamp = new Date().toISOString();
    let color: number, emoji: string, title: string;

    switch (status) {
      case 'success':
        color = 0x00ff00; // Green
        emoji = '✅';
        title = 'Cron Job Completed Successfully';
        break;
      case 'failed':
        color = 0xff0000; // Red
        emoji = '❌';
        title = 'Cron Job Failed';
        break;
      case 'started':
        color = 0x0099ff; // Blue
        emoji = '🔄';
        title = 'Cron Job Started';
        break;
      default:
        color = 0xffa500; // Orange
        emoji = '⚠️';
        title = 'Cron Job Alert';
    }

    const embed: DiscordEmbed = {
      title: `${emoji} ${title}: ${jobName}`,
      color,
      timestamp,
      fields: [
        {
          name: '📊 Status',
          value: status.toUpperCase(),
          inline: true,
        },
      ],
      footer: {
        text: 'Aleo Oracle Cron System',
      },
    };

    if (duration !== null) {
      embed.fields.push({
        name: '⏱️ Duration',
        value: `${duration}ms`,
        inline: true,
      });
    }

    if (error) {
      embed.fields.push({
        name: '❌ Error Details',
        value: `\`\`\`${error.message}\`\`\``,
        inline: false,
      });
    }

    return await this.sendEmbed(embed);
  }

  async sendServiceStatusAlert(
    service: string,
    status: 'online' | 'offline' | string,
    details: Record<string, any> = {}
  ): Promise<boolean> {
    if (!this.enableServiceStatusAlert) return false;

    const timestamp = new Date().toISOString();
    let color: number, emoji: string;

    switch (status) {
      case 'online':
        color = 0x00ff00; // Green
        emoji = '🟢';
        break;
      case 'offline':
        color = 0xff0000; // Red
        emoji = '🔴';
        break;
      default:
        color = 0xffa500; // Orange
        emoji = '🟡';
    }

    const embed: DiscordEmbed = {
      title: `${emoji} Service Status Alert`,
      color,
      timestamp,
      fields: [
        {
          name: '🔧 Service',
          value: service,
          inline: true,
        },
        {
          name: '📊 Status',
          value: status.toUpperCase(),
          inline: true,
        },
      ],
      footer: {
        text: 'Aleo Oracle Monitoring',
      },
    };

    // Add details fields if available
    if (Object.keys(details).length > 0) {
      const detailsText = Object.entries(details)
        .map(([key, value]) => `**${key}:** ${value}`)
        .join('\n');

      embed.fields.push({
        name: '📋 Details',
        value: detailsText,
        inline: false,
      });
    }

    return await this.sendEmbed(embed);
  }

  async sendPriceUpdateAlert(
    coinName: string,
    status: 'success' | 'failed',
    price: string | null = null,
    error: Error | null = null
  ): Promise<boolean> {
    if (!this.enablePriceUpdateAlert) return false;

    const timestamp = new Date().toISOString();
    let color: number, emoji: string, title: string;

    switch (status) {
      case 'success':
        color = 0x00ff00; // Green
        emoji = '💰';
        title = 'Price Update Successful';
        break;
      case 'failed':
        color = 0xff0000; // Red
        emoji = '💸';
        title = 'Price Update Failed';
        break;
      default:
        color = 0xffa500; // Orange
        emoji = '⚠️';
        title = 'Price Update Alert';
    }

    const embed: DiscordEmbed = {
      title: `${emoji} ${title}: ${coinName}`,
      color,
      timestamp,
      fields: [
        {
          name: '🪙 Coin',
          value: coinName,
          inline: true,
        },
        {
          name: '📊 Status',
          value: status.toUpperCase(),
          inline: true,
        },
      ],
      footer: {
        text: 'Aleo Oracle Price System',
      },
    };

    if (price) {
      embed.fields.push({
        name: '💵 Price',
        value: price,
        inline: true,
      });
    }

    if (error) {
      embed.fields.push({
        name: '❌ Error Details',
        value: `\`\`\`${error.message}\`\`\``,
        inline: false,
      });
    }

    return await this.sendEmbed(embed);
  }

  async sendSystemHealthAlert(healthData: Record<string, any>): Promise<boolean> {
    if (!this.enableSystemHealthAlert) return false;

    const timestamp = new Date().toISOString();

    const embed: DiscordEmbed = {
      title: '🏥 System Health Report',
      color: 0x0099ff, // Blue
      timestamp,
      fields: [
        {
          name: '📊 Health Status',
          value: 'System is running normally',
          inline: false,
        },
      ],
      footer: {
        text: 'Aleo Oracle Health Monitor',
      },
    };

    // Add health data fields
    Object.entries(healthData).forEach(([key, value]) => {
      embed.fields.push({
        name: `📋 ${key}`,
        value: String(value),
        inline: true,
      });
    });

    return await this.sendEmbed(embed);
  }

  async sendTransactionAlert(
    coinName: string,
    txnId: string,
    status: 'pending' | 'confirmed' | 'failed',
    details: Record<string, any> = {}
  ): Promise<boolean> {
    if (!this.enableTransactionAlert) return false;

    const timestamp = new Date().toISOString();
    let color: number, emoji: string;

    switch (status) {
      case 'confirmed':
        color = 0x00ff00; // Green
        emoji = '✅';
        break;
      case 'pending':
        color = 0xffa500; // Orange
        emoji = '⏳';
        break;
      case 'failed':
        color = 0xff0000; // Red
        emoji = '❌';
        break;
      default:
        color = 0x0099ff; // Blue
        emoji = '📝';
    }

    const embed: DiscordEmbed = {
      title: `${emoji} Transaction Alert: ${coinName}`,
      color,
      timestamp,
      fields: [
        {
          name: '🪙 Coin',
          value: coinName,
          inline: true,
        },
        {
          name: '📊 Status',
          value: status.toUpperCase(),
          inline: true,
        },
        {
          name: '🆔 Transaction ID',
          value: `\`${txnId}\``,
          inline: false,
        },
      ],
      footer: {
        text: 'Aleo Oracle Transaction Monitor',
      },
    };

    // Add details fields if available
    if (Object.keys(details).length > 0) {
      const detailsText = Object.entries(details)
        .map(([key, value]) => `**${key}:** ${value}`)
        .join('\n');

      embed.fields.push({
        name: '📋 Transaction Details',
        value: detailsText,
        inline: false,
      });
    }

    return await this.sendEmbed(embed);
  }
}

export const discordNotifier = new DiscordNotifier();
