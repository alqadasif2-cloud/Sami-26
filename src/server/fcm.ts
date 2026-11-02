import fs from 'fs';
import path from 'path';

const FCM_TOKENS_FILE = path.resolve('data', 'fcm_tokens.json');

export interface DeviceTokenRecord {
  token: string;
  userId: number;
  username: string;
  deviceId?: string;
  platform?: string;
  deviceModel?: string;
  updatedAt: number;
}

export interface NotificationPayload {
  title?: string;
  body?: string;
  chatType?: string;
  data?: Record<string, string>;
  [key: string]: any;
}

function loadTokens(): Record<string, DeviceTokenRecord> {
  try {
    if (fs.existsSync(FCM_TOKENS_FILE)) {
      return JSON.parse(fs.readFileSync(FCM_TOKENS_FILE, 'utf8'));
    }
  } catch {}
  return {};
}

function saveTokens(data: Record<string, DeviceTokenRecord>): void {
  try {
    fs.writeFileSync(FCM_TOKENS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch {}
}

export function hasServerFcmCredentials(): boolean {
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    process.env.FCM_SERVER_KEY ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.GCP_SERVICE_ACCOUNT_KEY
  );
}

export async function registerDeviceToken(params: {
  token: string;
  userId: number;
  username: string;
  deviceId?: string;
  platform?: string;
  deviceModel?: string;
}): Promise<DeviceTokenRecord> {
  const tokens = loadTokens();
  const record: DeviceTokenRecord = {
    token: params.token,
    userId: params.userId,
    username: params.username,
    deviceId: params.deviceId,
    platform: params.platform || 'android',
    deviceModel: params.deviceModel,
    updatedAt: Date.now(),
  };

  tokens[params.token] = record;
  saveTokens(tokens);
  return record;
}

export async function unregisterDeviceToken(
  userId: number,
  token?: string,
  deviceId?: string
): Promise<void> {
  const tokens = loadTokens();
  let changed = false;

  for (const [key, rec] of Object.entries(tokens)) {
    if (rec.userId === userId) {
      if (!token && !deviceId) {
        delete tokens[key];
        changed = true;
      } else if (token && rec.token === token) {
        delete tokens[key];
        changed = true;
      } else if (deviceId && rec.deviceId === deviceId) {
        delete tokens[key];
        changed = true;
      }
    }
  }

  if (changed) {
    saveTokens(tokens);
  }
}

export async function sendNotificationToUsers(
  recipientIds: number[],
  _payload: NotificationPayload
): Promise<{ success: boolean; dispatchedCount: number }> {
  const tokens = loadTokens();
  const targetTokens: string[] = [];

  for (const rec of Object.values(tokens)) {
    if (recipientIds.includes(rec.userId)) {
      targetTokens.push(rec.token);
    }
  }

  return {
    success: true,
    dispatchedCount: targetTokens.length,
  };
}

export async function dispatchAuthorizedChatPush(params: {
  senderId: number;
  senderName: string;
  senderRole?: string;
  chatType: 'channel' | 'private' | string;
  channelId?: string;
  receiverId?: number;
  messageId?: string;
  body?: string;
  snippet?: string;
}): Promise<{ count: number; success: boolean }> {
  const text = params.body || params.snippet || 'رسالة جديدة';
  const recipientIds = params.receiverId ? [params.receiverId] : [];

  const res = await sendNotificationToUsers(recipientIds, {
    title: params.senderName,
    body: text,
    chatType: params.chatType,
    data: {
      chatType: params.chatType,
      channelId: params.channelId || '',
      senderId: String(params.senderId),
    },
  });

  return { success: res.success, count: res.dispatchedCount };
}
