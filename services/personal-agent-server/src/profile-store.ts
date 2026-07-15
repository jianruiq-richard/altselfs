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
  saveReviewedUserProfile(
    userId: string,
    content: string,
    threadId?: string,
    reason?: string
  ): Promise<UserProfileEntry | null>;
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
    return this.saveProfileEntry(userId, content, threadId, 'The user explicitly asked to remember this long-term preference or profile detail');
  }

  async saveReviewedUserProfile(userId: string, content: string, threadId?: string, reason?: string) {
    const normalized = content.trim();
    if (!normalized) return null;
    return this.saveProfileEntry(userId, normalized, threadId, reason || 'Long-term user profile or preference identified by Hermes memory review');
  }

  private async saveProfileEntry(userId: string, content: string, threadId?: string, reason?: string) {
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
      reason: reason || 'Long-term user profile or preference',
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
    /(?:^|[.!?\n]\s*)(?:please\s+)?(?:remember|save|store|note)\s+(?:that\s+)?(?<content>[\s\S]+)/iu
  );
  let content = match?.groups?.content?.trim();
  if (!content) return '';
  content = content.replace(/(?:reason|rationale|source)[:：].*$/is, '').trim();
  content = content.replace(/^(?:that|this|my preference is|my profile is)[:：\s]*/iu, '').trim();
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
