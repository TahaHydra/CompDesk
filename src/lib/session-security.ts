export function isSessionTokenCurrent(params: {
    isInitialSignIn: boolean;
    tokenSessionVersion: unknown;
    tokenIssuedAtSeconds: unknown;
    databaseSessionVersion: number;
    credentialsChangedAt: Date | null;
}): boolean {
    if (params.isInitialSignIn) return true;
    if (typeof params.tokenSessionVersion === 'number' && params.tokenSessionVersion !== params.databaseSessionVersion) return false;
    if (params.credentialsChangedAt) {
        const issuedAtMs = typeof params.tokenIssuedAtSeconds === 'number' ? params.tokenIssuedAtSeconds * 1_000 : 0;
        if (issuedAtMs < params.credentialsChangedAt.getTime()) return false;
    }
    return true;
}