import { isRecord } from '../util.js';
export function projectCodexNotification(message) {
    const method = String(message.method || '');
    const params = isRecord(message.params) ? message.params : {};
    if (method === 'item/agentMessage/delta') {
        const delta = params.delta;
        if (typeof delta === 'string')
            return { assistantDelta: delta };
    }
    if (method === 'item/completed') {
        const item = isRecord(params.item) ? params.item : {};
        const text = extractText(item);
        const itemType = String(item.type || '');
        const role = String(item.role || '');
        const isAssistantMessage = itemType === 'agentMessage' ||
            itemType === 'assistantMessage' ||
            (itemType === 'message' && role === 'assistant');
        return {
            finalText: isAssistantMessage && text ? text : undefined,
            isToolIteration: itemType.includes('command') ||
                itemType.includes('tool') ||
                itemType.includes('file') ||
                itemType.includes('mcp'),
        };
    }
    if (method === 'turn/completed') {
        const turn = isRecord(params.turn) ? params.turn : {};
        const output = turn.output;
        if (typeof output === 'string')
            return { finalText: output };
    }
    return {};
}
function extractText(value) {
    if (typeof value === 'string')
        return value;
    if (!isRecord(value))
        return '';
    for (const key of ['text', 'content', 'message', 'finalText']) {
        const item = value[key];
        if (typeof item === 'string')
            return item;
    }
    const content = value.content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
            if (typeof part === 'string')
                return part;
            if (isRecord(part) && typeof part.text === 'string')
                return part.text;
            return '';
        })
            .filter(Boolean)
            .join('');
    }
    return '';
}
