import { PrismaClient } from '@prisma/client';
import { installDemoData } from '../scripts/demo-data.mjs';

const prisma = new PrismaClient();
async function main() {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_DEMO_SEED !== 'I_UNDERSTAND_THIS_CREATES_DEMO_DATA') {
        throw new Error('Demo seeding is disabled in production. Set ALLOW_PRODUCTION_DEMO_SEED=I_UNDERSTAND_THIS_CREATES_DEMO_DATA only for an intentional disposable demonstration.');
    }
    const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', isDemo: false } });
    const credentials = await installDemoData(prisma, {
        protectedUserId: admin?.id, domain: process.env.SEED_DEMO_DOMAIN, password: process.env.SEED_DEFAULT_PASSWORD,
        emails: [process.env.SEED_ADMIN_EMAIL, process.env.SEED_DEPARTMENT_ADMIN_EMAIL, process.env.SEED_AGENT1_EMAIL, process.env.SEED_AGENT2_EMAIL, process.env.SEED_USER1_EMAIL, process.env.SEED_USER2_EMAIL],
    });
    console.log('Demo dataset installed. Credentials (shown once):');
    for (const account of credentials.accounts) console.log(`${account.role}: ${account.email}`);
    console.log(`Password: ${credentials.password}`);
}
main().catch((error) => { console.error('Seed failed:', error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
