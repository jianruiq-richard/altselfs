export const HERMES_UPDATE_PLAN_TOOL_NAME = 'update_plan';
export const HERMES_UPDATE_PLAN_TOOL_DEFINITION = {
    name: HERMES_UPDATE_PLAN_TOOL_NAME,
    description: 'Publish the complete current execution plan to the user for complex multi-step work. Call again whenever the plan or step status materially changes. Include every useful step; there is no fixed step or tool-call count.',
    inputSchema: {
        type: 'object',
        properties: {
            summary: {
                type: 'string',
                description: 'Optional concise, user-visible summary of the current objective or plan change.',
            },
            steps: {
                type: 'array',
                description: 'The complete current plan in execution order. Keep step IDs stable across updates and include all steps needed for the task.',
                items: {
                    type: 'object',
                    properties: {
                        id: {
                            type: 'string',
                            description: 'Stable identifier for this step across later plan updates.',
                        },
                        title: {
                            type: 'string',
                            description: 'Concise user-visible description of the step.',
                        },
                        status: {
                            type: 'string',
                            enum: ['pending', 'in_progress', 'completed', 'blocked'],
                        },
                        detail: {
                            type: 'string',
                            description: 'Optional user-visible result, evidence, blocker, or next action for this step.',
                        },
                    },
                    required: ['id', 'title', 'status'],
                    additionalProperties: false,
                },
            },
        },
        required: ['steps'],
        additionalProperties: false,
    },
};
export function parseHermesPlanUpdate(value) {
    if (!isRecord(value))
        throw new Error('update_plan arguments must be an object.');
    if (!Array.isArray(value.steps))
        throw new Error('update_plan requires a steps array.');
    const seenIds = new Set();
    const steps = value.steps.map((rawStep, index) => {
        if (!isRecord(rawStep))
            throw new Error(`update_plan step ${index + 1} must be an object.`);
        const id = readRequiredString(rawStep.id, `update_plan step ${index + 1} requires a non-empty id.`);
        if (seenIds.has(id))
            throw new Error(`update_plan step id "${id}" is duplicated.`);
        seenIds.add(id);
        const title = readRequiredString(rawStep.title, `update_plan step "${id}" requires a non-empty title.`);
        const status = parseHermesPlanStepStatus(rawStep.status, id);
        const detail = readOptionalString(rawStep.detail);
        return {
            id,
            title,
            status,
            ...(detail ? { detail } : {}),
        };
    });
    const summary = readOptionalString(value.summary);
    return {
        ...(summary ? { summary } : {}),
        steps,
    };
}
function parseHermesPlanStepStatus(value, id) {
    if (value === 'pending' || value === 'in_progress' || value === 'completed' || value === 'blocked') {
        return value;
    }
    throw new Error(`update_plan step "${id}" status must be pending, in_progress, completed, or blocked.`);
}
function readRequiredString(value, errorMessage) {
    if (typeof value !== 'string' || !value.trim())
        throw new Error(errorMessage);
    return value.trim();
}
function readOptionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
