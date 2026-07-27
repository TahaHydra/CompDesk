export interface SubmissionLock {
    current: boolean;
}

interface Credentials {
    email: string;
    password: string;
}

interface AuthenticationResult {
    ok?: boolean;
    error?: string | null;
}

export type CredentialsSubmissionResult = 'success' | 'failure' | 'duplicate';

function readCredentials(formData: FormData): Credentials | null {
    const rawEmail = formData.get('email');
    const rawPassword = formData.get('password');
    if (typeof rawEmail !== 'string' || typeof rawPassword !== 'string') return null;

    const email = rawEmail.trim();
    if (!email || !rawPassword) return null;
    return { email, password: rawPassword };
}

export async function submitCredentialsOnce({
    formData,
    lock,
    authenticate,
    setPending,
}: {
    formData: FormData;
    lock: SubmissionLock;
    authenticate: (credentials: Credentials) => Promise<AuthenticationResult | undefined>;
    setPending: (pending: boolean) => void;
}): Promise<CredentialsSubmissionResult> {
    if (lock.current) return 'duplicate';

    lock.current = true;
    setPending(true);
    let succeeded = false;
    try {
        const credentials = readCredentials(formData);
        if (!credentials) return 'failure';

        const result = await authenticate(credentials);
        if (result?.error || !result?.ok) return 'failure';

        succeeded = true;
        return 'success';
    } catch {
        return 'failure';
    } finally {
        if (!succeeded) {
            lock.current = false;
            setPending(false);
        }
    }
}
