export function normalizeToolNameList(value) {
    if (!Array.isArray(value))
        return [];
    return Array.from(new Set(value
        .map((item) => typeof item === 'string' ? item.trim() : '')
        .filter(Boolean)));
}
export function buildConnectorToolScopeInstruction(enabledToolNames) {
    return [
        `Enabled connector tools for this turn: ${enabledToolNames.join(', ') || 'none'}.`,
        'Do not call connector tools that are not listed as enabled for this turn, even if an older resumed Codex session still exposes their schemas.',
    ].join('\n');
}
