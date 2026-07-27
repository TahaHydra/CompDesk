import { normalizeSettingValue, SettingsValidationError } from '@/lib/settings-validation';

describe('settings validation', () => {
    it('normalizes valid SMTP settings', () => {
        expect(normalizeSettingValue('smtp_host', ' smtp.example.com ')).toBe('smtp.example.com');
        expect(normalizeSettingValue('smtp_port', '0465')).toBe('465');
        expect(normalizeSettingValue('smtp_from', 'CompDesk <support@example.com>')).toBe('CompDesk <support@example.com>');
        expect(normalizeSettingValue('smtp_secure', 'true')).toBe('true');
    });

    it.each([
        ['smtp_host', 'https://smtp.example.com'],
        ['smtp_port', '0'],
        ['smtp_port', 'not-a-port'],
        ['smtp_from', 'not-an-email'],
        ['smtp_secure', 'yes'],
        ['email_on_ticket_created', '1'],
        ['azure_ad_client_secret', 'secret\nINJECTED=true'],
    ])('rejects an invalid %s value', (key, value) => {
        expect(() => normalizeSettingValue(key, value)).toThrow(SettingsValidationError);
    });
});