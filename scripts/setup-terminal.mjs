const ANSI = {
    reset: '\u001b[0m',
    blue: '\u001b[34m',
    cyan: '\u001b[36m',
    green: '\u001b[32m',
    yellow: '\u001b[33;1m',
    mutedYellow: '\u001b[33m',
};

function singleLine(value, label) {
    const normalized = String(value || '');
    if (!normalized || /[\r\n\u001b]/.test(normalized)) throw new Error(`${label} must be a non-empty single line.`);
    return normalized;
}

function paint(value, color, enabled) {
    return enabled ? `${ANSI[color]}${value}${ANSI.reset}` : value;
}

export function shouldUseSetupColors(stream = process.stdout, environment = process.env) {
    return Boolean(stream?.isTTY) && !Object.prototype.hasOwnProperty.call(environment, 'NO_COLOR') && environment.TERM !== 'dumb';
}

export function resolveSetupBrowserUrl({ explicitOrigin, publishedPort, listenerPort }) {
    if (explicitOrigin) return `${singleLine(explicitOrigin, 'Setup origin').replace(/\/$/, '')}/setup`;
    const rawPort = String(publishedPort || listenerPort || 3000);
    const candidatePort = /^\d+$/.test(rawPort) ? Number(rawPort) : Number.NaN;
    const safePort = Number.isInteger(candidatePort) && candidatePort >= 1 && candidatePort <= 65535 ? candidatePort : 3000;
    return `http://localhost:${safePort}/setup`;
}

export function formatSetupBanner({ token, setupUrl, ttlMinutes, color = false }) {
    const safeToken = singleLine(token, 'Bootstrap token');
    const safeUrl = singleLine(setupUrl, 'Setup URL');
    const expiry = Number.isInteger(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 30;
    const rows = [
        {
            plain: 'CompDesk first-run setup is active',
            rendered: paint('CompDesk first-run setup is active', 'cyan', color),
        },
        {
            plain: `Bootstrap token: ${safeToken}`,
            rendered: `${paint('Bootstrap token:', 'blue', color)} ${paint(safeToken, 'yellow', color)}`,
        },
        {
            plain: `Open: ${safeUrl}`,
            rendered: `${paint('Open:', 'blue', color)} ${paint(safeUrl, 'green', color)}`,
        },
        {
            plain: `Token expires in ${expiry} minutes`,
            rendered: paint(`Token expires in ${expiry} minutes`, 'mutedYellow', color),
        },
    ];
    const contentWidth = Math.max(...rows.map((row) => row.plain.length));
    const border = `+${'-'.repeat(contentWidth + 2)}+`;
    const renderedBorder = paint(border, 'blue', color);
    return [
        renderedBorder,
        ...rows.map((row) => `${paint('|', 'blue', color)} ${row.rendered}${' '.repeat(contentWidth - row.plain.length)} ${paint('|', 'blue', color)}`),
        renderedBorder,
    ].join('\n');
}

export function setupRecoveryGuidance() {
    return [
        'Lost the token? Run: docker compose logs --tail=50 compdesk',
        'Token expired? Run: docker compose restart compdesk, then check the logs again.',
    ].join('\n');
}
