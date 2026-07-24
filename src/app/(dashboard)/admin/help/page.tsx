'use client';

import { BookOpen } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { HelpCenterManager } from '@/components/admin/help-center-manager';
import { useLanguage } from '@/components/providers/language-provider';

export default function AdminHelpPage() {
    const { t } = useLanguage();
    return <div className="space-y-6"><PageHeader icon={BookOpen} title={t('Manage Help Center')} description={t('Create and maintain bilingual help articles for users.')} /><HelpCenterManager /></div>;
}