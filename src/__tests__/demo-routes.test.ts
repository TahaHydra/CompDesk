const mockAuth = jest.fn();
const mockState = jest.fn();
const mockInstall = jest.fn();
const mockRemove = jest.fn();
jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/demo-service', () => ({ getDemoState: mockState, installDemoData: mockInstall, removeDemoData: mockRemove }));
import { GET, POST, DELETE } from '@/app/api/settings/demo/route';

beforeEach(() => jest.clearAllMocks());
it.each([null, 'USER', 'AGENT', 'ADMIN'])('rejects demo inspection and management by %s', async (role) => {
    mockAuth.mockResolvedValue(role ? { user: { id: 'user', role } } : null);
    expect((await GET()).status).toBe(403);
    expect((await POST(new Request('http://localhost/api/settings/demo', { method: 'POST' }))).status).toBe(403);
    expect((await DELETE(new Request('http://localhost/api/settings/demo', { method: 'DELETE' }))).status).toBe(403);
    expect(mockInstall).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
});
it('requires explicit installation confirmation and returns credentials without caching', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin', role: 'SUPER_ADMIN' } });
    const noConfirmation = await POST(new Request('http://localhost/api/settings/demo', { method: 'POST', body: '{}' }));
    expect(noConfirmation.status).toBe(400);
    expect(mockInstall).not.toHaveBeenCalled();
    mockInstall.mockResolvedValue({ accounts: [{ email: 'demo@example.com', role: 'USER' }], password: 'generated' });
    const response = await POST(new Request('http://localhost/api/settings/demo', { method: 'POST', body: JSON.stringify({ confirmation: 'INSTALL-DEMO-DATA' }) }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mockInstall).toHaveBeenCalledWith('admin');
});
it('requires deletion confirmation and protects the signed-in super admin', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin', role: 'SUPER_ADMIN' } });
    expect((await DELETE(new Request('http://localhost/api/settings/demo', { method: 'DELETE', body: '{}' }))).status).toBe(400);
    expect(mockRemove).not.toHaveBeenCalled();
    mockRemove.mockResolvedValue({ removed: 6, retained: 0, deactivated: 0 });
    const response = await DELETE(new Request('http://localhost/api/settings/demo', { method: 'DELETE', body: JSON.stringify({ confirmation: 'REMOVE-DEMO-DATA' }) }));
    expect(response.status).toBe(200);
    expect(mockRemove).toHaveBeenCalledWith('admin');
});
