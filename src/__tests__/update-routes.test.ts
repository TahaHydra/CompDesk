const mockAuth = jest.fn();
const mockGetUpdateState = jest.fn();
const mockReadiness = jest.fn();
jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/update-service', () => ({ getUpdateState: mockGetUpdateState }));
jest.mock('@/lib/health', () => ({ readinessChecks: mockReadiness }));
import { GET, POST } from '@/app/api/updates/route';
import { GET as instructions } from '@/app/api/updates/instructions/route';
import { GET as health } from '@/app/api/updates/health/route';

beforeEach(() => {
    jest.clearAllMocks();
    mockGetUpdateState.mockResolvedValue({ installed: '0.9.3', checkStatus: 'ok' });
    mockReadiness.mockResolvedValue({ database: true, installation: true, migrations: true, privateStorage: true });
});
describe('update endpoint authorization', () => {
    it.each([null, 'USER', 'AGENT'])('denies update information to %s', async (role) => {
        mockAuth.mockResolvedValue(role ? { user: { id: 'user', role } } : null);
        expect((await GET()).status).toBe(403);
        expect((await POST()).status).toBe(403);
        expect((await health()).status).toBe(403);
        expect(mockGetUpdateState).not.toHaveBeenCalled();
    });
    it.each(['ADMIN', 'SUPER_ADMIN'])('allows %s to inspect and refresh cached updates', async (role) => {
        mockAuth.mockResolvedValue({ user: { id: 'user', role } });
        const response = await GET();
        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect((await POST()).status).toBe(200);
        expect(mockGetUpdateState).toHaveBeenLastCalledWith(true);
    });
    it('denies privileged instructions to ADMIN with an explicit reason', async () => {
        mockAuth.mockResolvedValue({ user: { id: 'user', role: 'ADMIN' } });
        const response = await instructions();
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: 'Super Admin privileges required' });
    });
    it('offers assisted commands to SUPER_ADMIN, with no execution endpoint', async () => {
        mockAuth.mockResolvedValue({ user: { id: 'user', role: 'SUPER_ADMIN' } });
        const response = await instructions();
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ command: 'docker compose pull\ndocker compose up -d' });
    });
    it('reuses readiness and never invents a recovery point or update history', async () => {
        mockAuth.mockResolvedValue({ user: { id: 'user', role: 'ADMIN' } });
        const response = await health();
        expect(await response.json()).toEqual({
            application: true, database: true, installation: true, migrations: true, storage: true,
            recoveryPoint: null, previousVersion: null, lastSuccessfulUpdate: null,
        });
    });
});
