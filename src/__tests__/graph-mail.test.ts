const mockSettings = jest.fn();
jest.mock('@/lib/prisma', () => ({ prisma: { appSetting: { findMany: mockSettings } } }));
import { sendGraphMail, resetGraphMailTokenCache } from '@/lib/graph-mail';
const config = { tenantId: '11111111-1111-4111-8111-111111111111', clientId: '22222222-2222-4222-8222-222222222222', secret: 'synthetic', sender: 'desk@example.test' };
const fetchMock = jest.fn();
beforeEach(() => { resetGraphMailTokenCache(); jest.clearAllMocks(); global.fetch = fetchMock; fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }))).mockResolvedValue(new Response(null, { status: 202 })); });
test('app credentials token is cached and messages use only the fixed sender', async () => {
    await sendGraphMail({ to: 'one@example.test', subject: 'Ticket', html: '<p>Hi</p>' }, config);
    await sendGraphMail({ to: 'two@example.test', subject: 'Ticket', html: '<p>Hi</p>' }, config);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][1].body.get('grant_type')).toBe('client_credentials');
    expect(fetchMock.mock.calls[1][0]).toBe('https://graph.microsoft.com/v1.0/users/desk%40example.test/sendMail');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).message.toRecipients).toHaveLength(1);
});
test('provider errors expose status without returning credential or message content', async () => {
    fetchMock.mockReset().mockResolvedValue(new Response('secret token message', { status: 403 }));
    await expect(sendGraphMail({ to: 'one@example.test', subject: 'Ticket', html: 'private' }, config)).rejects.toThrow('403');
});
