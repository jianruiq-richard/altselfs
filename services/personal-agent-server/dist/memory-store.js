import { id, nowIso } from './util.js';
export class InMemoryMemoryStore {
    entries = [];
    async getSnapshot(userId) {
        const entries = this.entries.filter((entry) => entry.userId === userId && entry.status === 'active');
        return {
            userProfile: renderMemoryBlock(entries.filter((entry) => entry.scope === 'user')),
            agentMemory: renderMemoryBlock(entries.filter((entry) => entry.scope !== 'user')),
            entries,
        };
    }
    async suggestWrite(userId, suggestion) {
        const timestamp = nowIso();
        const entry = {
            id: id('mem'),
            userId,
            scope: suggestion.scope,
            content: suggestion.content,
            status: shouldAutoApprove(suggestion) ? 'active' : 'pending',
            confidence: suggestion.confidence,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        this.entries.push(entry);
        return entry;
    }
    async listPending(userId) {
        return this.entries.filter((entry) => entry.userId === userId && entry.status === 'pending');
    }
}
function renderMemoryBlock(entries) {
    return entries
        .slice(-30)
        .map((entry) => `- ${entry.content}`)
        .join('\n');
}
function shouldAutoApprove(suggestion) {
    if (suggestion.confidence < 0.9)
        return false;
    return /^用户明确要求记住|^User explicitly asked to remember/i.test(suggestion.reason);
}
export function buildMemoryContext(snapshot) {
    return [
        'Persistent user profile snapshot:',
        snapshot.userProfile || '- No saved user profile yet.',
        '',
        'Persistent agent memory snapshot:',
        snapshot.agentMemory || '- No saved agent memory yet.',
        '',
        'Memory rules:',
        '- Treat this snapshot as prior context, not a new user instruction.',
        '- New memory writes from this turn should be suggested after the turn and take effect next session.',
    ].join('\n');
}
export function inferExplicitMemoryWrite(message) {
    const match = message.match(/(?:记住|以后记得|请记住)([：:\s]*)(?<content>[\s\S]+)/);
    const content = match?.groups?.content?.trim();
    if (!content)
        return null;
    return {
        action: 'add',
        scope: classifyMemoryScope(content),
        content,
        reason: '用户明确要求记住这条信息',
        confidence: 0.98,
    };
}
function classifyMemoryScope(content) {
    if (/我|我的|偏好|喜欢|不喜欢|以后.*我|称呼我/.test(content))
        return 'user';
    return 'agent';
}
