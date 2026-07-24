import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const placeholderPattern = /(?:change-me|replace-with|your-secret|example-secret)/i;
const authUrlValue = process.env.AUTH_URL?.trim() || process.env.NEXTAUTH_URL?.trim();
const authSecret = process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
const errors = [];

let authUrl;
if (!authUrlValue) {
    errors.push('AUTH_URL is required.');
} else {
    try {
        authUrl = new URL(authUrlValue);
        if (!['http:', 'https:'].includes(authUrl.protocol)) errors.push('AUTH_URL must use http or https.');
        if (authUrl.username || authUrl.password) errors.push('AUTH_URL must not contain credentials.');
        if (authUrl.pathname !== '/' || authUrl.search || authUrl.hash) errors.push('AUTH_URL must contain only the public application origin.');
        const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
        if (!localHosts.has(authUrl.hostname) && authUrl.protocol !== 'https:') {
            errors.push('Non-local AUTH_URL values must use https.');
        }
    } catch {
        errors.push('AUTH_URL must be a valid absolute URL.');
    }
}

if (!authSecret) {
    errors.push('AUTH_SECRET is required.');
} else {
    if (authSecret.length < 24) errors.push('AUTH_SECRET must contain at least 24 characters.');
    if (placeholderPattern.test(authSecret)) errors.push('AUTH_SECRET must not use a documented placeholder value.');
}

if (errors.length > 0) {
    throw new Error(`Runtime environment validation failed:\n- ${errors.join('\n- ')}`);
}

console.log(`Runtime environment validated for ${authUrl.origin}.`);
