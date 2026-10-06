// A login-page sign-in switches accounts. Profile linking deliberately keeps
// the authenticated session and uses Auth.js's ownership checks instead.
export async function startSsoSignIn({ endSession, authenticate }: {
    endSession: () => Promise<unknown>;
    authenticate: () => Promise<unknown>;
}): Promise<void> {
    await endSession();
    await authenticate();
}

export function getSignInErrorMessage(error: string, localLoginEnabled: boolean, providerLabel = 'Microsoft'): string {
    if (error === 'OAuthAccountNotLinked') {
        return localLoginEnabled
            ? `${providerLabel} sign-in could not use the current CompDesk account. Try ${providerLabel} sign-in again to start a fresh session. To link an existing local account, sign in with its password, then use My Profile → Link my ${providerLabel} account.`
            : `${providerLabel} sign-in could not use the current CompDesk account. Try ${providerLabel} sign-in again to start a fresh session. If the problem continues, contact an administrator.`;
    }
    return 'Authentication failed. Please try again or contact an administrator.';
}
