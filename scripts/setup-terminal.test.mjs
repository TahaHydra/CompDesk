import assert from 'node:assert/strict';
import test from 'node:test';
import {
    formatSetupBanner,
    resolveSetupBrowserUrl,
    setupRecoveryGuidance,
    shouldUseSetupColors,
} from './setup-terminal.mjs';

const token = 'test-bootstrap-token-without-real-secret-material';

test('plain bootstrap output is compact, readable, and contains the token exactly once', () => {
    const output = formatSetupBanner({ token, setupUrl: 'http://localhost:3000/setup', ttlMinutes: 30, color: false });
    assert.equal(output.split('\n').length, 6);
    assert.match(output, /CompDesk first-run setup is active/);
    assert.match(output, /Open: http:\/\/localhost:3000\/setup/);
    assert.match(output, /Token expires in 30 minutes/);
    assert.equal(output.split(token).length - 1, 1);
    assert.equal(output.includes('\u001b['), false);
});

test('the formatter never inserts a line break into a long token', () => {
    const longToken = `token-${'x'.repeat(160)}`;
    const output = formatSetupBanner({ token: longToken, setupUrl: 'https://helpdesk.example.test/setup', ttlMinutes: 30 });
    const tokenLines = output.split('\n').filter((line) => line.includes(longToken));
    assert.equal(tokenLines.length, 1);
    assert.equal(tokenLines[0].includes(longToken), true);
});

test('NO_COLOR disables ANSI even for a TTY while supported TTYs may use restrained color', () => {
    assert.equal(shouldUseSetupColors({ isTTY: true }, { NO_COLOR: '' }), false);
    assert.equal(shouldUseSetupColors({ isTTY: true }, { TERM: 'xterm-256color' }), true);
    const colored = formatSetupBanner({ token, setupUrl: 'http://localhost:3000/setup', ttlMinutes: 30, color: true });
    assert.match(colored, /\u001b\[/);
    assert.equal(colored.split(token).length - 1, 1);
});

test('setup URL respects explicit origin and the published Compose port', () => {
    assert.equal(resolveSetupBrowserUrl({ explicitOrigin: 'https://helpdesk.example.test', publishedPort: 3000 }), 'https://helpdesk.example.test/setup');
    assert.equal(resolveSetupBrowserUrl({ publishedPort: '4310', listenerPort: 3000 }), 'http://localhost:4310/setup');
    assert.equal(resolveSetupBrowserUrl({ publishedPort: 'invalid', listenerPort: 3000 }), 'http://localhost:3000/setup');
});

test('recovery guidance uses local Compose operations and never repeats the token', () => {
    const guidance = setupRecoveryGuidance();
    assert.match(guidance, /docker compose logs --tail=50 compdesk/);
    assert.match(guidance, /docker compose restart compdesk/);
    assert.equal(guidance.includes(token), false);
});

test('control characters are rejected to prevent terminal log injection', () => {
    assert.throws(() => formatSetupBanner({ token: 'unsafe\ntoken', setupUrl: 'http://localhost:3000/setup', ttlMinutes: 30 }));
    assert.throws(() => formatSetupBanner({ token, setupUrl: 'http://localhost:3000/setup\u001b[2J', ttlMinutes: 30 }));
});
