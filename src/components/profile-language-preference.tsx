'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Globe2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { useLanguage } from '@/components/providers/language-provider';
import { LANGUAGE_LABELS, type AppLanguage } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function LanguagePreference({ initialLanguage }: { initialLanguage: AppLanguage }) {
    const router = useRouter();
    const { toast } = useToast();
    const { language, setLanguage, t } = useLanguage();
    const [selected, setSelected] = useState<AppLanguage>(initialLanguage);
    const [saving, setSaving] = useState(false);

    const save = async () => {
        setSaving(true);
        try {
            const response = await fetch('/api/profile/preferences', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ preferredLanguage: selected }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || t('Could not update language'));
            setLanguage(payload.preferredLanguage);
            toast({ title: selected === 'fr' ? 'Langue mise à jour' : 'Language updated' });
            router.refresh();
        } catch (error) {
            toast({
                title: t('Could not update language'),
                description: error instanceof Error ? error.message : undefined,
                variant: 'destructive',
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card className="border shadow-sm">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base"><Globe2 className="h-4 w-4" />{t('Interface language')}</CardTitle>
                <CardDescription>{t('Choose the language used across your workspace.')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="inline-flex w-fit rounded-lg border bg-muted/40 p-1" role="group" aria-label={t('Language')}>
                    {(['en', 'fr'] as const).map((option) => (
                        <button
                            key={option}
                            type="button"
                            onClick={() => setSelected(option)}
                            className={cn(
                                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                                selected === option ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                            )}
                            aria-pressed={selected === option}
                        >
                            {LANGUAGE_LABELS[option]}
                        </button>
                    ))}
                </div>
                <Button size="sm" onClick={save} disabled={saving || selected === language}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {t('Save preference')}
                </Button>
            </CardContent>
        </Card>
    );
}