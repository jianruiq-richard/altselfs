import fs from 'node:fs/promises';
import path from 'node:path';
import { id, nowIso } from './util.js';

export type UserProfileEntry = {
  id: string;
  userId: string;
  content: string;
  reason: string;
  sourceThreadId?: string;
  createdAt: string;
  updatedAt: string;
};

export type UserProfileSnapshot = {
  userId: string;
  entries: UserProfileEntry[];
  rendered: string;
};

export interface UserProfileStore {
  getSnapshot(userId: string): Promise<UserProfileSnapshot>;
  rememberExplicitUserProfile(userId: string, message: string, threadId?: string): Promise<UserProfileEntry | null>;
}

type ProfileDatabase = {
  users: Record<string, UserProfileEntry[]>;
};

export class LocalProfileStore implements UserProfileStore {
  constructor(private filePath: string) {}

  async getSnapshot(userId: string): Promise<UserProfileSnapshot> {
    const database = await this.readDatabase();
    const entries = (database.users[userId] || []).slice(-50);
    return {
      userId,
      entries,
      rendered: renderProfile(entries),
    };
  }

  async rememberExplicitUserProfile(userId: string, message: string, threadId?: string) {
    const content = extractExplicitProfileContent(message);
    if (!content) return null;

    const database = await this.readDatabase();
    const entries = database.users[userId] || [];
    const existing = entries.find((entry) => normalizeContent(entry.content) === normalizeContent(content));
    const timestamp = nowIso();
    if (existing) {
      existing.updatedAt = timestamp;
      if (threadId) existing.sourceThreadId = threadId;
      await this.writeDatabase(database);
      return existing;
    }

    const entry: UserProfileEntry = {
      id: id('profile'),
      userId,
      content,
      reason: '用户明确要求长期记住这条偏好或画像信息',
      sourceThreadId: threadId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    database.users[userId] = [...entries, entry];
    await this.writeDatabase(database);
    return entry;
  }

  private async readDatabase(): Promise<ProfileDatabase> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!isProfileDatabase(parsed)) return { users: {} };
      return parsed;
    } catch {
      return { users: {} };
    }
  }

  private async writeDatabase(database: ProfileDatabase) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(database, null, 2)}\n`, 'utf8');
  }
}

function renderProfile(entries: UserProfileEntry[]) {
  return entries.map((entry) => `- ${entry.content}`).join('\n');
}

function extractExplicitProfileContent(message: string) {
  const match = message.match(
    /(?:^|[。！？\n]\s*)(?:请你?|帮我)?(?:记住|请记住|以后记得|帮我记住)(?:[：:\s]+)(?<content>[\s\S]+)/u
  );
  let content = match?.groups?.content?.trim();
  if (!content) return '';
  content = content.replace(/(?:请)?只回复[：:].*$/s, '').trim();
  content = content.replace(/(?:请)?回复[：:].*$/s, '').trim();
  content = content.replace(/^(这个偏好|这条偏好|这件事)[：:\s]*/u, '').trim();
  return content;
}

function normalizeContent(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function isProfileDatabase(value: unknown): value is ProfileDatabase {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const users = (value as { users?: unknown }).users;
  return Boolean(users) && typeof users === 'object' && !Array.isArray(users);
}
