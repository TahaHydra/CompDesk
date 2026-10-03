import { getSignInErrorMessage, startMicrosoftSignIn } from '@/lib/microsoft-signin';

describe('Microsoft sign-in versus account linking', () => {
    it('ends the current session before starting a fresh Microsoft login', async () => {
        const operations: string[] = [];
        await startMicrosoftSignIn({
            endSession: async () => { operations.push('sign-out'); },
            authenticate: async () => { operations.push('Microsoft sign-in'); },
        });
        expect(operations).toEqual(['sign-out', 'Microsoft sign-in']);
    });

    it('does not start Microsoft login if ending the existing session fails', async () => {
        const authenticate = jest.fn();
        await expect(startMicrosoftSignIn({
            endSession: async () => { throw new Error('Network failure'); },
            authenticate,
        })).rejects.toThrow('Network failure');
        expect(authenticate).not.toHaveBeenCalled();
    });

    it('gives account-conflict recovery steps including explicit linking for local accounts', () => {
        const message = getSignInErrorMessage('OAuthAccountNotLinked', true);
        expect(message).toContain('fresh session');
        expect(message).toContain('My Profile');
        expect(message).toContain('password');
    });

    it('does not suggest unavailable local login when it is disabled', () => {
        const message = getSignInErrorMessage('OAuthAccountNotLinked', false);
        expect(message).toContain('fresh session');
        expect(message).not.toContain('password');
    });

    it('keeps unknown errors generic without reflecting arbitrary query text', () => {
        expect(getSignInErrorMessage('private-token-or-email', true)).toBe(
            'Authentication failed. Please try again or contact an administrator.',
        );
    });
});
