// A login-page sign-in switches accounts. Profile linking deliberately keeps
// the authenticated session and uses Auth.js's ownership checks instead.
export async function startMicrosoftSignIn({ endSession, authenticate }: {
    endSession: () => Promise<unknown>;
    authenticate: () => Promise<unknown>;
}): Promise<void> {
    await endSession();
    await authenticate();
}

export function getSignInErrorMessage(error: string, localLoginEnabled: boolean): string {
    if (error === 'OAuthAccountNotLinked') {
        return localLoginEnabled
            ? 'Microsoft sign-in could not use the current CompDesk account. Try Microsoft sign-in again to start a fresh session. To link an existing local account, sign in with its password, then use My Profile → Link my Microsoft account.'
            : 'Microsoft sign-in could not use the current CompDesk account. Try Microsoft sign-in again to start a fresh session. If the problem continues, contact an administrator.';
    }
    return 'Authentication failed. Please try again or contact an administrator.';
}
