'use client';

import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

interface ConfirmDestructiveActionProps {
    trigger: ReactNode;
    title: string;
    description: ReactNode;
    onConfirm: () => void;
    confirmLabel?: string;
    pendingLabel?: string;
    pending?: boolean;
    disabled?: boolean;
    actionClassName?: string;
}

export function ConfirmDestructiveAction({
    trigger,
    title,
    description,
    onConfirm,
    confirmLabel = 'Yes, delete',
    pendingLabel = 'Deleting…',
    pending = false,
    disabled = false,
    actionClassName,
}: ConfirmDestructiveActionProps) {
    return (
        <AlertDialog>
            <AlertDialogTrigger asChild disabled={disabled || pending}>
                {trigger}
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-destructive" />
                        {title}
                    </AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        className={cn('bg-destructive text-destructive-foreground hover:bg-destructive/90', actionClassName)}
                        disabled={pending}
                        onClick={onConfirm}
                    >
                        {pending ? pendingLabel : confirmLabel}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
