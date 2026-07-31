const mockSendMail = jest.fn();
const mockAuditLog = jest.fn();
const mockFindMany = jest.fn();

jest.mock('nodemailer', () => ({
    __esModule: true,
    default: { createTransport: jest.fn(() => ({ sendMail: mockSendMail })) },
}));
jest.mock('@/lib/logger', () => ({
    __esModule: true,
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('@/lib/prisma', () => ({
    prisma: { appSetting: { findMany: mockFindMany } },
}));
jest.mock('@/lib/branding', () => ({
    getBrandingConfig: jest.fn(async () => ({
        applicationName: 'CompDesk',
        mainLogoUrl: '',
        lightLogoUrl: '',
        primaryColor: '#4f46e5',
        accentColor: '#8b5cf6',
        footerText: '',
        supportEmail: '',
    })),
}));
jest.mock('@/lib/audit', () => ({ auditLog: mockAuditLog }));

import { sendEmail } from '@/lib/email';

describe('email delivery', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFindMany.mockResolvedValue([
            { key: 'smtp_host', value: 'smtp.example.com' },
            { key: 'smtp_port', value: '587' },
            { key: 'smtp_secure', value: 'false' },
            { key: 'smtp_user', value: 'sender@example.com' },
            { key: 'smtp_password', value: 'secret' },
            { key: 'smtp_from', value: 'sender@example.com' },
        ]);
        mockSendMail.mockResolvedValue({ accepted: ['recipient@example.com'] });
        mockAuditLog.mockResolvedValue(undefined);
    });

    it('sends group notifications separately so recipients cannot see each other', async () => {
        await expect(sendEmail({
            to: ['one@example.com', 'two@example.com', 'one@example.com'],
            subject: 'Ticket update',
            html: '<p>Update</p>',
        })).resolves.toBe(true);

        expect(mockSendMail).toHaveBeenCalledTimes(2);
        expect(mockSendMail.mock.calls.map(([message]) => message.to)).toEqual(['one@example.com', 'two@example.com']);
        expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'email.delivery_succeeded' }));
    });

    it('records a classified transport failure', async () => {
        mockSendMail.mockRejectedValue(Object.assign(new Error('blocked'), { code: 'EACCES' }));

        await expect(sendEmail({
            to: 'one@example.com',
            subject: 'Ticket update',
            html: '<p>Update</p>',
        })).resolves.toBe(false);

        expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
            action: 'email.delivery_failed',
            metadata: expect.objectContaining({ error: expect.stringContaining('operating system or container network policy') }),
        }));
    });
});