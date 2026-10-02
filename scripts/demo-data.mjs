import crypto from 'node:crypto';
import { seedDemoDataset } from './demo-dataset.mjs';

export const DEMO_LEDGER_KEY = 'demo_dataset';
export const DEMO_CONFIRMATION = 'REMOVE-DEMO-DATA';
const MODELS = ['user', 'ticket', 'queue', 'category', 'group', 'ticketFormTemplate', 'tag', 'slaPolicy', 'cannedResponse', 'helpCollection', 'helpArticle'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYSTEM_TEMPLATE_ID = '00000000-0000-0000-0000-000000000001';

export function parseDemoLedger(value) {
    try {
        const ledger = JSON.parse(value);
        if (!ledger || ledger.version !== 1 || typeof ledger.installedAt !== 'string' || !Number.isFinite(Date.parse(ledger.installedAt))
            || Object.keys(ledger).some((key) => !['version', 'installedAt', 'records'].includes(key))
            || !ledger.records || typeof ledger.records !== 'object' || Array.isArray(ledger.records)) return null;
        for (const [model, ids] of Object.entries(ledger.records)) {
            if (!MODELS.includes(model) || !Array.isArray(ids) || ids.length > 1000 || ids.some((id) => typeof id !== 'string' || !UUID.test(id))) return null;
        }
        return ledger;
    } catch { return null; }
}

function problem(message) { return Object.assign(new Error(message), { statusCode: 409 }); }

async function readLedger(tx) {
    const stored = await tx.appSetting.findUnique({ where: { key: DEMO_LEDGER_KEY } });
    if (!stored) return null;
    const ledger = parseDemoLedger(stored.value);
    if (!ledger) throw problem('Demo ownership information is invalid. No data was changed.');
    return ledger;
}

async function lock(tx) {
    await tx.$queryRawUnsafe('SELECT 1 AS locked FROM pg_advisory_xact_lock(174209381)');
}

// Record only rows created by this dataset. Existing shared rows are reused
// without changing their settings, credentials, tags or template fields.
function trackedClient(tx, records) {
    return new Proxy(tx, {
        get(target, model) {
            const delegate = target[model];
            if (!MODELS.includes(model)) return delegate;
            return new Proxy(delegate, {
                get(modelDelegate, method) {
                    if (method !== 'create' && method !== 'upsert') return modelDelegate[method];
                    return async (args) => {
                        if (method === 'upsert') {
                            const existing = await modelDelegate.findUnique({ where: args.where, ...(args.include ? { include: args.include } : {}) });
                            if (existing && model === 'user') throw problem('An existing account conflicts with the demo dataset. No data was changed.');
                            if (existing) return existing;
                        }
                        const row = await modelDelegate[method](args);
                        records[model].push(row.id);
                        return row;
                    };
                },
            });
        },
    });
}

// Also usable inside the installation transaction: a failed seed never
// commits a partially installed application or a misleading installation flag.
export async function installDemoDataInTransaction(tx, options = {}) {
    await lock(tx);
    if (await readLedger(tx)) throw problem('Demo data is already installed.');
    const collision = await tx.queue.findFirst({ where: { name: { in: ['IT Support', 'HR', 'Finance'] } } });
    const templateCollision = await tx.ticketFormTemplate.findFirst({ where: { id: { in: ['10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'] } } });
    const helpCollision = await tx.helpCollection.findFirst({ where: { slug: { in: ['getting-started', 'tickets', 'account', 'agents'] } } });
    if (collision || templateCollision || helpCollision) throw problem('Existing content conflicts with the demo dataset. No data was changed.');
    const records = Object.fromEntries(MODELS.map((model) => [model, []]));
    const legacyUsers = await tx.user.findMany({ where: { isDemo: true, ...(options.protectedUserId ? { id: { not: options.protectedUserId } } : {}) }, select: { id: true } });
    records.user.push(...legacyUsers.map((user) => user.id));
    const credentials = await seedDemoDataset(trackedClient(tx, records), { ...options, domain: options.domain || `demo-${crypto.randomBytes(5).toString('hex')}.example.com` });
    const ledger = { version: 1, installedAt: new Date().toISOString(), records };
    await tx.appSetting.create({ data: { key: DEMO_LEDGER_KEY, value: JSON.stringify(ledger) } });
    await tx.installationRecord.updateMany({ where: { id: 'primary' }, data: { demoDataInstalled: true } });
    return credentials;
}

export function installDemoData(client, options = {}) {
    return client.$transaction((tx) => installDemoDataInTransaction(tx, options), { isolationLevel: 'Serializable', timeout: 60000 });
}

export async function getDemoState(client) {
    const ledger = await readLedger(client);
    const accounts = await client.user.count({ where: { isDemo: true } });
    const tickets = ledger ? await client.ticket.count({ where: { id: { in: ledger.records.ticket || [] } } }) : 0;
    return { installed: Boolean(ledger) || accounts > 0, managed: Boolean(ledger), accounts, tickets, installedAt: ledger?.installedAt || null };
}

export async function removeDemoData(client, { protectedUserId, confirmation } = {}) {
    if (confirmation !== DEMO_CONFIRMATION) throw Object.assign(new Error('Explicit demo removal confirmation is required.'), { statusCode: 400 });
    return client.$transaction(async (tx) => {
        await lock(tx);
        const ledger = await readLedger(tx);
        const records = ledger?.records || {};
        const retained = Object.fromEntries(MODELS.map((model) => [model, []]));
        const configuredQueues = new Set();
        const configuredCategories = new Set();
        const quickLinks = await tx.appSetting.findUnique({ where: { key: 'dashboard_links' } });
        if (quickLinks) {
            let links;
            try { links = JSON.parse(quickLinks.value); } catch { throw problem('Quick-link configuration is invalid. No data was changed.'); }
            if (!Array.isArray(links)) throw problem('Quick-link configuration is invalid. No data was changed.');
            for (const link of links) {
                if (link?.type !== 'ticket_form') continue;
                if (typeof link.queueId === 'string' && UUID.test(link.queueId)) configuredQueues.add(link.queueId);
                if (typeof link.categoryId === 'string' && UUID.test(link.categoryId)) configuredCategories.add(link.categoryId);
            }
        }
        for (const client of await tx.apiClient.findMany({ select: { allowedQueueIds: true } })) {
            for (const id of client.allowedQueueIds) configuredQueues.add(id);
        }
        let removed = 0;
        let deactivated = 0;
        const attachments = await tx.attachment.findMany({ where: { ticketId: { in: records.ticket || [] } }, select: { path: true, ticketId: true } });
        for (const id of records.ticket || []) removed += (await tx.ticket.deleteMany({ where: { id } })).count;
        const ids = (model) => records[model] || [];
        const removeUnless = async (model, id, references) => {
            if (references) { retained[model].push(id); return; }
            removed += (await tx[model].deleteMany({ where: { id } })).count;
        };
        for (const id of ids('category')) await removeUnless('category', id, configuredCategories.has(id) || await tx.ticket.count({ where: { categoryId: id } }));
        for (const id of ids('queue')) await removeUnless('queue', id,
            Number(configuredQueues.has(id)) + (await tx.ticket.count({ where: { queueId: id } })) + (await tx.category.count({ where: { queueId: id } }))
            + (await tx.queueMember.count({ where: { queueId: id, user: { isDemo: false } } }))
            + (await tx.queueGroup.count({ where: { queueId: id, OR: [{ groupId: { notIn: ids('group') } }, { group: { members: { some: { user: { isDemo: false } } } } }] } }))
            + (await tx.slaPolicy.count({ where: { queueId: id, id: { notIn: ids('slaPolicy') } } })));
        for (const row of await tx.slaPolicy.findMany({ where: { id: { in: ids('slaPolicy') } }, select: { id: true } })) retained.slaPolicy.push(row.id);
        for (const id of ids('group')) await removeUnless('group', id,
            (await tx.groupMember.count({ where: { groupId: id, user: { isDemo: false } } }))
            + (await tx.queueGroup.count({ where: { groupId: id } })));
        for (const id of ids('ticketFormTemplate')) {
            if (id === SYSTEM_TEMPLATE_ID) continue; // Required application infrastructure stays.
            await removeUnless('ticketFormTemplate', id, (await tx.ticket.count({ where: { resolvedTemplateId: id } }))
                + (await tx.queue.count({ where: { defaultTemplateId: id } })) + (await tx.category.count({ where: { templateId: id } })));
        }
        for (const id of ids('tag')) await removeUnless('tag', id, await tx.ticketTag.count({ where: { tagId: id } }));
        for (const model of ['cannedResponse', 'helpArticle']) for (const id of ids(model)) await removeUnless(model, id, 0);
        for (const id of ids('helpCollection')) await removeUnless('helpCollection', id, await tx.helpArticle.count({ where: { collectionId: id } }));
        const users = await tx.user.findMany({ where: { isDemo: true, ...(protectedUserId ? { id: { not: protectedUserId } } : {}) }, select: { id: true } });
        for (const { id } of users) {
            const references = (await tx.ticket.count({ where: { OR: [{ requesterId: id }, { escalatedById: id }, { escalatedToId: id }] } }))
                + (await tx.ticketAssignee.count({ where: { OR: [{ userId: id }, { assignedById: id }] } }))
                + (await tx.timelineEvent.count({ where: { userId: id } })) + (await tx.auditLog.count({ where: { userId: id } }))
                + (await tx.attachment.count({ where: { uploaderId: id } })) + (await tx.temporaryAttachment.count({ where: { userId: id } }));
            if (references) {
                await tx.user.update({ where: { id }, data: { isActive: false, passwordHash: null, sessionVersion: { increment: 1 } } });
                await tx.session.deleteMany({ where: { userId: id } });
                await tx.account.deleteMany({ where: { userId: id } });
                retained.user.push(id);
                deactivated += 1;
            } else removed += (await tx.user.deleteMany({ where: { id, isDemo: true } })).count;
        }
        if (protectedUserId && ids('user').includes(protectedUserId)) retained.user.push(protectedUserId);
        const retainedCount = Object.values(retained).reduce((count, list) => count + list.length, 0);
        if (ledger) {
            if (retainedCount) await tx.appSetting.update({ where: { key: DEMO_LEDGER_KEY }, data: { value: JSON.stringify({ ...ledger, records: retained }) } });
            else await tx.appSetting.delete({ where: { key: DEMO_LEDGER_KEY } });
        }
        await tx.installationRecord.updateMany({ where: { id: 'primary' }, data: { demoDataInstalled: retainedCount > 0 } });
        return { removed, retained: retainedCount, deactivated, attachments };
    }, { isolationLevel: 'Serializable', timeout: 60000 });
}
