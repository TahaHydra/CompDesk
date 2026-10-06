import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';
import { getBrandingConfig, saveBrandingConfig } from '@/lib/branding';
import {
    assertProposedAuthentication, countUsersLinkedTo, getSsoState, isLoginMethodEnabled, isRuntimeProviderConfigured, isUsableBinding, providerAccountFilter,
    SSO_MIGRATION_PHASE_KEY, SSO_MIGRATION_TARGET_KEY, type SsoState,
} from '@/lib/login-policy';
import { getRuntimeOidcConfig } from '@/lib/oidc-provider';
import { clearOidcSlot, isRuntimeConfigOutdated } from '@/lib/sso-settings';
import {
    activeProviderId, defaultSsoButtonText, isDefaultSsoButtonText, SSO_OIDC_SLOT_KEY, SSO_PRESETS, SSO_PROVIDER_SETTING_KEY,
    ssoAuthProviderId, targetProviderId, type OidcRuntimeSlot, type RuntimeSsoProviderId, type SsoProviderOption,
} from '@/lib/sso-presets';

/**
 * SSO migration mode. Users link the new provider's `issuer + subject` while the old provider still
 * works, an administrator who has linked (and therefore authenticated with) the new provider cuts
 * over, and the old provider stays usable for linked accounts during a rollback window. Accounts are
 * never matched by email, and no binding is rewritten: cut-over and rollback only flip settings.
 */
export class SsoMigrationError extends Error {}

export interface MigrationProgress {
    provider: SsoProviderOption;
    migrationTarget: SsoProviderOption | null;
    migrationPhase: SsoState['migrationPhase'];
    activeProviderId: RuntimeSsoProviderId;
    targetProviderId: RuntimeSsoProviderId | null;
    targetConfigured: boolean;
    users: { active: number; linkedToActive: number; linkedToTarget: number };
    superAdmins: Array<{ id: string; name: string; email: string; hasPassword: boolean; linkedActive: boolean; linkedTarget: boolean }>;
    actorLinkedToTarget: boolean;
    blockers: string[];
    warnings: string[];
}

function issuerOf(providerId: RuntimeSsoProviderId | null): string | null {
    if (!providerId || providerId === 'microsoft-entra-id') return null;
    return getRuntimeOidcConfig(providerId === 'oidc' ? 'OIDC' : 'OIDC_NEXT')?.issuer ?? null;
}

async function writeState(values: Record<string, string | null>): Promise<void> {
    await prisma.$transaction(Object.entries(values).map(([key, value]) => value === null
        ? prisma.appSetting.deleteMany({ where: { key } })
        : prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })));
}

async function followButtonText(previous: SsoProviderOption, next: SsoProviderOption): Promise<void> {
    const branding = await getBrandingConfig();
    if (!isDefaultSsoButtonText(branding.microsoftButtonText) || branding.microsoftButtonText !== defaultSsoButtonText(previous)) return;
    await saveBrandingConfig({
        ...branding,
        showLocalLogin: await isLoginMethodEnabled('login_local_enabled'),
        showMicrosoftLogin: await isLoginMethodEnabled('login_sso_enabled'),
        microsoftButtonText: defaultSsoButtonText(next),
    });
}

export async function getMigrationProgress(actorId: string): Promise<MigrationProgress> {
    const state = await getSsoState();
    const activeId = activeProviderId(state);
    const targetId = targetProviderId(state);
    const [activeUsers, linkedToActive, linkedToTarget, admins] = await Promise.all([
        prisma.user.count({ where: { isActive: true } }),
        countUsersLinkedTo(activeId, { isActive: true }),
        targetId ? countUsersLinkedTo(targetId, { isActive: true }) : Promise.resolve(0),
        prisma.user.findMany({
            where: { role: 'SUPER_ADMIN', isActive: true },
            select: { id: true, name: true, email: true, passwordHash: true, accounts: { select: { provider: true, providerAccountId: true, id_token: true } } },
            orderBy: { email: 'asc' },
        }),
    ]);
    const superAdmins = admins.map((admin) => ({
        id: admin.id, name: admin.name, email: admin.email, hasPassword: Boolean(admin.passwordHash),
        linkedActive: admin.accounts.some((account) => isUsableBinding(activeId, account)),
        linkedTarget: Boolean(targetId) && admin.accounts.some((account) => isUsableBinding(targetId!, account)),
    }));
    const targetConfigured = targetId ? isRuntimeProviderConfigured(targetId) : false;
    const actorLinkedToTarget = superAdmins.some((admin) => admin.id === actorId && admin.linkedTarget);
    const blockers: string[] = [];
    const warnings: string[] = [];
    if (state.migrationPhase === 'rollback' && await isRuntimeConfigOutdated(activeId)) {
        blockers.push(`The saved ${SSO_PRESETS[state.provider].label} settings differ from the running configuration. Restart CompDesk and verify sign-in before finishing the migration.`);
    }
    if (state.migrationPhase === 'staging') {
        if (!targetConfigured) blockers.push(`${SSO_PRESETS[state.migrationTarget!].label} is not active in the running application yet. Save its settings and restart CompDesk.`);
        // A link verified against the loaded configuration proves nothing about saved settings a restart would load instead.
        if (targetId && await isRuntimeConfigOutdated(targetId)) blockers.push(`The saved ${SSO_PRESETS[state.migrationTarget!].label} settings differ from the running configuration. Restart CompDesk, then link (or re-test) your account again before cutting over.`);
        if (!actorLinkedToTarget) blockers.push(`Link your own ${SSO_PRESETS[state.migrationTarget!].label} account from Profile first; this proves the new provider works for an administrator.`);
        const issuer = issuerOf(targetId);
        if (issuer && issuer === issuerOf(activeId)) blockers.push('The new provider uses the same issuer as the active one; there is nothing to migrate.');
        const unlinked = superAdmins.filter((admin) => !admin.linkedTarget).length;
        if (unlinked) warnings.push(`${unlinked} active Super Admin(s) have not linked the new provider yet${(await isLoginMethodEnabled('login_local_enabled')) ? '; they can still use their local password.' : ' and local login is disabled.'}`);
        if (linkedToTarget < activeUsers) warnings.push(`${activeUsers - linkedToTarget} active user(s) have not linked the new provider. They can link it later from Profile while signed in.`);
    }
    return { provider: state.provider, migrationTarget: state.migrationTarget, migrationPhase: state.migrationPhase, activeProviderId: activeId, targetProviderId: targetId, targetConfigured, users: { active: activeUsers, linkedToActive, linkedToTarget }, superAdmins, actorLinkedToTarget, blockers, warnings };
}

export async function startMigration(target: SsoProviderOption, actorId: string): Promise<void> {
    const state = await getSsoState();
    if (state.migrationTarget) throw new SsoMigrationError('An SSO migration is already in progress.');
    if (target === state.provider) throw new SsoMigrationError('Choose a provider other than the active one.');
    if (!targetProviderId({ ...state, migrationTarget: target })) throw new SsoMigrationError('Migrating from Microsoft Entra ID to Microsoft Entra ID is not supported; update the Entra settings instead.');
    await writeState({ [SSO_MIGRATION_TARGET_KEY]: target, [SSO_MIGRATION_PHASE_KEY]: 'staging' });
    await auditLog({ userId: actorId, action: 'sso.migration_started', entity: 'auth', metadata: { from: state.provider, to: target } });
}

export async function cancelMigration(actorId: string): Promise<void> {
    const state = await getSsoState();
    if (state.migrationPhase !== 'staging') throw new SsoMigrationError('Only a migration that has not been cut over can be cancelled.');
    await writeState({ [SSO_MIGRATION_TARGET_KEY]: null, [SSO_MIGRATION_PHASE_KEY]: null });
    await auditLog({ userId: actorId, action: 'sso.migration_cancelled', entity: 'auth', metadata: { from: state.provider, to: state.migrationTarget } });
}

/** Swaps active and target. Used for cut-over (staging → rollback) and rollback (rollback → staging). */
async function swap(state: SsoState, nextPhase: 'staging' | 'rollback'): Promise<{ provider: SsoProviderOption; oidcSlot: OidcRuntimeSlot }> {
    const targetId = targetProviderId(state)!;
    const provider = state.migrationTarget!;
    const oidcSlot: OidcRuntimeSlot = ssoAuthProviderId(provider) === 'oidc' ? targetId as OidcRuntimeSlot : state.oidcSlot;
    await assertProposedAuthentication({ ssoProvider: provider, oidcSlot, migrationCutover: true });
    await writeState({ [SSO_PROVIDER_SETTING_KEY]: provider, [SSO_OIDC_SLOT_KEY]: oidcSlot, [SSO_MIGRATION_TARGET_KEY]: state.provider, [SSO_MIGRATION_PHASE_KEY]: nextPhase });
    await followButtonText(state.provider, provider);
    return { provider, oidcSlot };
}

export async function cutoverMigration(actorId: string): Promise<void> {
    const state = await getSsoState();
    if (state.migrationPhase !== 'staging') throw new SsoMigrationError('There is no staged migration to cut over.');
    const progress = await getMigrationProgress(actorId);
    if (progress.blockers.length) throw new SsoMigrationError(progress.blockers[0]);
    await swap(state, 'rollback');
    await auditLog({ userId: actorId, action: 'sso.migration_cutover', entity: 'auth', metadata: { from: state.provider, to: state.migrationTarget, linkedUsers: progress.users.linkedToTarget, activeUsers: progress.users.active } });
}

export async function rollbackMigration(actorId: string): Promise<void> {
    const state = await getSsoState();
    if (state.migrationPhase !== 'rollback') throw new SsoMigrationError('Rollback is available only after a cut-over, until the migration is finished.');
    const previousId = targetProviderId(state)!;
    if (!isRuntimeProviderConfigured(previousId)) throw new SsoMigrationError('The previous provider is no longer configured in the running application.');
    if (await isRuntimeConfigOutdated(previousId)) throw new SsoMigrationError('The previous provider\'s saved settings differ from the running configuration. Restart CompDesk before rolling back.');
    await swap(state, 'staging');
    await auditLog({ userId: actorId, action: 'sso.migration_rolled_back', entity: 'auth', metadata: { from: state.provider, to: state.migrationTarget } });
}

/**
 * Ends the rollback window. Old bindings are kept unless `pruneOldBindings` is set; the previous
 * OpenID Connect slot's credentials are removed (effective after the next restart).
 */
export async function finishMigration(actorId: string, options: { pruneOldBindings: boolean }): Promise<{ restartRequired: boolean; prunedBindings: number }> {
    const state = await getSsoState();
    if (state.migrationPhase !== 'rollback') throw new SsoMigrationError('Finish is available after a cut-over.');
    // The previous provider's credentials are removed only while the active one is verified as loaded.
    if (await isRuntimeConfigOutdated(activeProviderId(state))) throw new SsoMigrationError('The active provider\'s saved settings differ from the running configuration. Restart CompDesk and verify sign-in before finishing the migration.');
    const previousId = targetProviderId(state)!;
    let prunedBindings = 0;
    if (options.pruneOldBindings) {
        const previousAccounts = providerAccountFilter(previousId);
        const previousIssuer = issuerOf(previousId);
        if (!previousAccounts) throw new SsoMigrationError('The previous provider is no longer loaded, so its bindings cannot be identified safely. Finish without pruning.');
        if (previousIssuer && previousIssuer === issuerOf(activeProviderId(state))) throw new SsoMigrationError('The previous and active providers share an issuer; pruning would remove active bindings.');
        prunedBindings = (await prisma.account.deleteMany({ where: previousAccounts })).count;
    }
    await writeState({ [SSO_MIGRATION_TARGET_KEY]: null, [SSO_MIGRATION_PHASE_KEY]: null });
    const restartRequired = previousId === 'microsoft-entra-id' ? false : await clearOidcSlot(previousId === 'oidc' ? 'oidc' : 'oidc_next');
    await auditLog({ userId: actorId, action: 'sso.migration_finished', entity: 'auth', metadata: { previous: state.migrationTarget, prunedBindings } });
    return { restartRequired, prunedBindings };
}
