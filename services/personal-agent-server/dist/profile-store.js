import fs from 'node:fs/promises';
import path from 'node:path';
import { id, nowIso } from './util.js';
export class LocalProfileStore {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async getSnapshot(userId) {
        const database = await this.readDatabase();
        const entries = (database.users[userId] || []).slice(-50);
        return {
            userId,
            entries,
            rendered: renderProfile(entries),
        };
    }
    async rememberExplicitUserProfile(userId, message, threadId) {
        const content = extractExplicitProfileContent(message);
        if (!content)
            return null;
        const database = await this.readDatabase();
        const entries = database.users[userId] || [];
        const existing = entries.find((entry) => normalizeContent(entry.content) === normalizeContent(content));
        const timestamp = nowIso();
        if (existing) {
            existing.updatedAt = timestamp;
            if (threadId)
                existing.sourceThreadId = threadId;
            await this.writeDatabase(database);
            return existing;
        }
        const entry = {
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
    async readDatabase() {
        try {
            const raw = await fs.readFile(this.filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (!isProfileDatabase(parsed))
                return { users: {} };
            return parsed;
        }
        catch {
            return { users: {} };
        }
    }
    async writeDatabase(database) {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(this.filePath, `${JSON.stringify(database, null, 2)}\n`, 'utf8');
    }
}
function renderProfile(entries) {
    return entries.map((entry) => `- ${entry.content}`).join('\n');
}
function extractExplicitProfileContent(message) {
    const match = message.match(/(?:记住|请记住|以后记得|帮我记住)(?:[：:\s]*)(?<content>[\s\S]+)/);
    let content = match?.groups?.content?.trim();
    if (!content)
        return '';
    content = content.replace(/(?:请)?只回复[：:].*$/s, '').trim();
    content = content.replace(/(?:请)?回复[：:].*$/s, '').trim();
    content = content.replace(/^(这个偏好|这条偏好|这件事)[：:\s]*/u, '').trim();
    return content;
}
function normalizeContent(value) {
    return value.replace(/\s+/g, ' ').trim().toLowerCase();
}
function isProfileDatabase(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const users = value.users;
    return Boolean(users) && typeof users === 'object' && !Array.isArray(users);
}
