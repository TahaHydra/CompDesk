import { readFileSync } from 'fs';
import path from 'path';

const seed = readFileSync(path.join(process.cwd(), 'prisma', 'seed.ts'), 'utf8');

describe('realistic demo data contract', () => {
    it('ships useful department templates and assigns department defaults', () => {
        for (const template of ['Standard Request', 'IT Support Request', 'Access & Permission Request', 'HR Request', 'Finance Request']) {
            expect(seed).toContain(`'${template}'`);
        }
        expect(seed).toContain('defaultTemplateId: itTemplate.id');
        expect(seed).toContain('defaultTemplateId: hrTemplate.id');
        expect(seed).toContain('defaultTemplateId: financeTemplate.id');
        expect(seed).toContain("'Access & permissions'");
        expect(seed).toContain('accessTemplate.id');
    });

    it('defines department-specific category sets and guarded legacy cleanup', () => {
        for (const category of [
            'Hardware & devices', 'Network & connectivity', 'Leave & absence', 'Employee documents',
            'Expenses & reimbursements', 'Invoices & payments', 'Budget & cost centers',
        ]) expect(seed).toContain(`'${category}'`);
        expect(seed).toContain('if (category._count.tickets === 0)');
        expect(seed).toContain("removeLegacyCategoryCopies(hrQueue.id, ['Access', 'Hardware', 'Network', 'Software'])");
        expect(seed).toContain("removeLegacyCategoryCopies(financeQueue.id, ['Access', 'Hardware', 'Network', 'Onboarding', 'Payroll', 'Software'])");
    });

    it('seeds bilingual searchable help content', () => {
        expect(seed).toContain("titleFr: 'Bienvenue dans CompDesk'");
        expect(seed).toContain("slug: 'create-a-clear-ticket'");
        expect(seed).toContain("slug: 'change-your-language'");
    });
});