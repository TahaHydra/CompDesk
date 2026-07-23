'use client';

import { Moon, Monitor, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTheme } from '@/components/providers/theme-provider';

const options = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
] as const;

export function ThemeToggle() {
    const { theme, resolvedTheme, setTheme } = useTheme();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Toggle theme">
                    {resolvedTheme === 'dark' ? (
                        <Moon className="h-5 w-5" />
                    ) : (
                        <Sun className="h-5 w-5" />
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
                {options.map((option) => (
                    <DropdownMenuItem
                        key={option.value}
                        onClick={() => setTheme(option.value)}
                        className="cursor-pointer"
                    >
                        <option.icon className="mr-2 h-4 w-4" />
                        <span>{option.label}</span>
                        {theme === option.value ? <span className="ml-auto text-xs">✓</span> : null}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

