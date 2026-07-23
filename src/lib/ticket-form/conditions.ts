import type { FieldConditionalRules } from '@/lib/ticket-form/types';

function valuesEqual(left: unknown, right: unknown): boolean {
    if (Array.isArray(left) || Array.isArray(right)) return JSON.stringify(left) === JSON.stringify(right);
    return left === right || String(left ?? '') === String(right ?? '');
}

export function isFieldConditionVisible(
    rules: FieldConditionalRules | null,
    values: Record<string, unknown>
): boolean {
    if (!rules) return true;
    const controllingKey = rules.fieldKey ?? rules.dependsOn;
    if (!controllingKey) return true;
    const actual = values[controllingKey];
    const expected = rules.fieldKey ? rules.value : rules.showWhen;
    const operator = rules.operator ?? 'equals';
    if (operator === 'truthy') return Boolean(actual);
    if (operator === 'notEquals') return !valuesEqual(actual, expected);
    if (operator === 'contains') {
        if (Array.isArray(actual)) return actual.some((item) => valuesEqual(item, expected));
        return typeof actual === 'string' && actual.includes(String(expected ?? ''));
    }
    if (operator === 'in') return Array.isArray(expected) && expected.some((item) => valuesEqual(actual, item));
    return valuesEqual(actual, expected);
}