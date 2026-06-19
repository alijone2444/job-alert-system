const PREFIX = '📱 JobAlert';

function formatMessage(tag: string, message: string): string {
  return `${PREFIX} [${tag}] ${message}`;
}

export const logger = {
  info(tag: string, message: string, data?: unknown) {
    if (data !== undefined) {
      console.log(formatMessage(tag, message), data);
    } else {
      console.log(formatMessage(tag, message));
    }
  },

  success(tag: string, message: string, data?: unknown) {
    if (data !== undefined) {
      console.log(formatMessage(tag, `✅ ${message}`), data);
    } else {
      console.log(formatMessage(tag, `✅ ${message}`));
    }
  },

  warn(tag: string, message: string, data?: unknown) {
    if (data !== undefined) {
      console.warn(formatMessage(tag, `⚠️ ${message}`), data);
    } else {
      console.warn(formatMessage(tag, `⚠️ ${message}`));
    }
  },

  error(tag: string, message: string, error?: unknown) {
    if (error !== undefined) {
      console.error(formatMessage(tag, `❌ ${message}`), error);
    } else {
      console.error(formatMessage(tag, `❌ ${message}`));
    }
  },

  divider(tag: string) {
    console.log(`${PREFIX} [${tag}] ${'─'.repeat(40)}`);
  },
};
