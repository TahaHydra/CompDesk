'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import type { Session } from 'next-auth';
import type { LucideIcon } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    LayoutDashboard,
    Ticket,
    Plus,
    Inbox,
    Settings,
    Users,
    FolderKanban,
    Tags,
    Tag,
    FileText,
    Shield,
    LogOut,
    ChevronLeft,
    Menu,
    Search,
    Bell,
    MessageSquare,
    ArrowRightLeft,
    UserCheck,
    CheckCircle2,
    AlertTriangle,
    BookOpen,
} from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { BrandLogo } from '@/components/branding/brand-logo';
import { useBranding } from '@/components/providers/branding-provider';
import { useLanguage } from '@/components/providers/language-provider';
import { installInteractionLockGuard } from '@/lib/browser-interaction';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface NavigationItem {
    href: string;
    label: string;
    icon: LucideIcon;
    roles?: string[];
}

const navItems: NavigationItem[] = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN'] },
    { href: '/tickets', label: 'My Tickets', icon: Ticket, roles: ['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN'] },
    { href: '/tickets/new', label: 'New Ticket', icon: Plus, roles: ['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN'] },
    { href: '/queue', label: 'Department Inbox', icon: Inbox, roles: ['AGENT', 'ADMIN', 'SUPER_ADMIN'] },
    { href: '/help', label: 'Help Center', icon: BookOpen, roles: ['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN'] },
];

const adminItems: NavigationItem[] = [
    { href: '/admin/departments', label: 'Departments', icon: FolderKanban, roles: ['ADMIN', 'SUPER_ADMIN'] },
    { href: '/admin/categories', label: 'Categories', icon: Tags, roles: ['ADMIN', 'SUPER_ADMIN'] },
    { href: '/admin/templates', label: 'Ticket Templates', icon: FileText, roles: ['ADMIN', 'SUPER_ADMIN'] },
    { href: '/admin/tags', label: 'Tags', icon: Tag, roles: ['SUPER_ADMIN'] },
    { href: '/admin/users', label: 'Users', icon: Users, roles: ['SUPER_ADMIN'] },
    { href: '/admin/help', label: 'Help Content', icon: BookOpen, roles: ['ADMIN', 'SUPER_ADMIN'] },
    { href: '/admin/logs', label: 'Logs', icon: FileText, roles: ['SUPER_ADMIN'] },
    { href: '/admin/settings', label: 'Settings', icon: Settings, roles: ['SUPER_ADMIN'] },
];

const notificationIcon = (type: string) => {
    switch (type) {
        case 'COMMENT': case 'INTERNAL_NOTE': return <MessageSquare className="h-4 w-4 text-blue-500" />;
        case 'STATUS_CHANGE': return <ArrowRightLeft className="h-4 w-4 text-amber-500" />;
        case 'ASSIGNMENT_CHANGE': return <UserCheck className="h-4 w-4 text-indigo-500" />;
        case 'ESCALATED': return <AlertTriangle className="h-4 w-4 text-red-500" />;
        case 'CREATED': return <Plus className="h-4 w-4 text-green-500" />;
        default: return <CheckCircle2 className="h-4 w-4 text-muted-foreground" />;
    }
};

export default function AppShell({
    children,
    initialSession,
}: {
    children: React.ReactNode;
    initialSession: Session;
}) {
    const { data: clientSession, status } = useSession();
    const branding = useBranding();
    const { t, language } = useLanguage();
    const pathname = usePathname();
    const router = useRouter();
    const queryClient = useQueryClient();
    // Never downgrade a temporarily unavailable client session to USER.
    // The server-validated session remains authoritative until a refresh
    // restores the client session or redirects an expired login.
    const session = clientSession?.user?.role ? clientSession : initialSession;
    // collapsed = desktop rail collapse; mobileOpen = off-canvas drawer on phones/tablets
    const [collapsed, setCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [notifOpen, setNotifOpen] = useState(false);

    const userRole = session.user.role;
    const isAdminUser = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN';
    const initials = session?.user?.name?.split(' ').map(n => n[0]).join('').toUpperCase() ?? '?';

    // Close the mobile drawer whenever the route changes. We deliberately do NOT
    // refresh the session here: next-auth's `update` is re-created whenever the
    // session or its loading flag changes, so depending on it — and calling it —
    // creates a refetch/re-render loop that saturates the main thread and makes
    // every control stop responding a few seconds after load. The SessionProvider
    // already refreshes on an interval and on window focus.
    useEffect(() => {
        setMobileOpen(false);
    }, [pathname]);

    // A modal layer (dialog, alert dialog, modal select) interrupted by client
    // navigation or Edge's back/forward cache can leave `pointer-events: none`
    // on <body> after it disappears, which silently kills every click on the
    // page. The guard watches the body style and self-heals on the next frame
    // whenever that lock leaks, while leaving genuine open modals untouched.
    useEffect(() => installInteractionLockGuard(window), []);

    useEffect(() => {
        if (status === 'unauthenticated') {
            router.refresh();
        }
    }, [router, status]);

    // Lock body scroll while the mobile drawer is open
    useEffect(() => {
        if (mobileOpen) {
            document.body.style.overflow = 'hidden';
            return () => { document.body.style.overflow = ''; };
        }
    }, [mobileOpen]);

    const { data: notifications } = useQuery({
        queryKey: ['notifications'],
        queryFn: async () => {
            const res = await fetch('/api/notifications');
            if (!res.ok) return { items: [], unreadCount: 0 };
            return res.json();
        },
        refetchInterval: 30000,
        enabled: !!session?.user,
    });

    const markAllRead = useCallback(async () => {
        await fetch('/api/notifications', { method: 'POST' });
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }, [queryClient]);

    const unreadCount = notifications?.unreadCount ?? 0;

    const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

    // Primary navigation deliberately uses native anchors. The App Router can be
    // left in a stale client state after a standalone rebuild or Edge back/forward
    // restore; a native navigation always requests the current server document and
    // still preserves modifier-click and open-in-new-tab browser behavior.
    const NavLink = ({ item, active }: { item: NavigationItem; active: boolean }) => (
        <a
            href={item.href}
            title={item.label}
            onClick={() => setMobileOpen(false)}
            aria-current={active ? 'page' : undefined}
            className={cn(
                'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-200',
                active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
        >
            {active && (
                <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
            )}
            <item.icon className={cn('h-5 w-5 shrink-0', collapsed && 'lg:mx-auto')} />
            <span className={cn('truncate', collapsed && 'lg:hidden')}>{item.label}</span>
        </a>
    );
    return (
        <div className="flex h-screen overflow-hidden bg-background">
            {/* Backdrop for mobile drawer */}
            {mobileOpen && (
                <div
                    className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-sm lg:hidden animate-fade-in"
                    onClick={() => setMobileOpen(false)}
                    aria-hidden="true"
                />
            )}

            {/* Sidebar — off-canvas drawer on mobile, collapsible rail on desktop */}
            <aside
                className={cn(
                    'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-card transition-transform duration-300 ease-in-out',
                    'lg:static lg:z-auto lg:translate-x-0 lg:transition-[width]',
                    mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
                    collapsed ? 'lg:w-16' : 'lg:w-64'
                )}
            >
                {/* Logo */}
                <Link href="/" className="flex h-16 items-center gap-3 border-b px-4 transition-colors hover:bg-accent/50">
                    <BrandLogo compact={collapsed} className="h-9 w-9 shrink-0 rounded-xl shadow-md shadow-primary/25" />
                    <div className={cn('min-w-0', collapsed && 'lg:hidden')}>
                        <h1 className="truncate font-display text-lg font-bold leading-tight gradient-text">{branding.shortApplicationName}</h1>
                        <p className="-mt-0.5 truncate text-[10px] uppercase tracking-widest text-muted-foreground">{branding.subtitle}</p>
                    </div>
                </Link>

                {/* Nav */}
                <ScrollArea className="flex-1 px-3 py-4">
                    <nav className="space-y-1">
                        {navItems
                            .filter((item) => item.roles?.includes(userRole))
                            .map((item) => (
                                <NavLink key={item.href} item={{ ...item, label: t(item.label) }} active={isActive(item.href)} />
                            ))}
                    </nav>

                    {isAdminUser && (
                        <>
                            <Separator className="my-4" />
                            <p className={cn(
                                'mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
                                collapsed && 'lg:hidden'
                            )}>
                                {t('Administration')}
                            </p>
                            <nav className="space-y-1">
                                {adminItems.filter((item) => item.roles?.includes(userRole)).map((item) => (
                                    <NavLink key={item.href} item={{ ...item, label: t(item.label) }} active={isActive(item.href)} />
                                ))}
                            </nav>
                        </>
                    )}
                </ScrollArea>

                {/* Collapse button — desktop only */}
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    aria-label={t(collapsed ? 'Expand sidebar' : 'Collapse sidebar')}
                    className="absolute -right-3 top-20 hidden h-6 w-6 items-center justify-center rounded-full border bg-background shadow-sm transition-colors hover:bg-accent lg:flex"
                >
                    <ChevronLeft className={cn('h-3 w-3 transition-transform', collapsed && 'rotate-180')} />
                </button>
            </aside>

            {/* Main content */}
            <div className="flex flex-1 flex-col overflow-hidden">
                {/* Top bar */}
                <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b bg-card/70 px-3 backdrop-blur-md sm:px-6">
                    <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
                        <button
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
                            onClick={() => setMobileOpen(true)}
                            aria-label={t('Open menu')}
                        >
                            <Menu className="h-5 w-5" />
                        </button>
                        <div className="relative w-full max-w-xs sm:max-w-sm">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder={t('Search tickets...')}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="h-9 w-full bg-muted/60 pl-9"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && searchQuery.trim()) {
                                        router.push(`/tickets?search=${encodeURIComponent(searchQuery.trim())}`);
                                    }
                                }}
                            />
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                        <ThemeToggle />
                        <Popover open={notifOpen} onOpenChange={setNotifOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="ghost" size="icon" className="relative" aria-label={t('Notifications')}>
                                    <Bell className="h-5 w-5" />
                                    {unreadCount > 0 && (
                                        <span className="absolute right-1.5 top-1.5 flex h-2 w-2">
                                            <span className="absolute inline-flex h-full w-full animate-pulse-dot rounded-full bg-red-500" />
                                            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                                        </span>
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-[calc(100vw-2rem)] max-w-96 p-0">
                                <div className="flex items-center justify-between border-b px-4 py-3">
                                    <h3 className="text-sm font-semibold">{t('Notifications')}</h3>
                                    {unreadCount > 0 && (
                                        <Button variant="ghost" size="sm" className="h-7 text-xs text-primary" onClick={markAllRead}>
                                            {t('Mark all as read')}
                                        </Button>
                                    )}
                                </div>
                                <ScrollArea className="max-h-80">
                                    {(!notifications?.items || notifications.items.length === 0) ? (
                                        <div className="flex flex-col items-center justify-center py-10 text-center">
                                            <Bell className="mb-2 h-8 w-8 text-muted-foreground/40" />
                                            <p className="text-sm text-muted-foreground">{t('No notifications yet')}</p>
                                            <p className="mt-1 text-xs text-muted-foreground/70">{t('Activity on your tickets will show up here')}</p>
                                        </div>
                                    ) : (
                                        <div className="divide-y">
                                            {notifications.items.map((n: any) => (
                                                <Link
                                                    key={n.id}
                                                    href={`/tickets/${n.ticketId}`}
                                                    onClick={() => setNotifOpen(false)}
                                                    className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                                                >
                                                    <div className="mt-0.5 shrink-0">{notificationIcon(n.type)}</div>
                                                    <div className="min-w-0 flex-1">
                                                        <p className="truncate text-sm font-medium">{n.ticketKey}: {n.ticketTitle}</p>
                                                        <p className="truncate text-xs text-muted-foreground">{n.content || n.type.replace(/_/g, ' ').toLowerCase()}</p>
                                                        <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                                                            {n.userName} · {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: language === 'fr' ? fr : undefined })}
                                                        </p>
                                                    </div>
                                                </Link>
                                            ))}
                                        </div>
                                    )}
                                </ScrollArea>
                            </PopoverContent>
                        </Popover>

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="flex h-auto items-center gap-2 p-1.5">
                                    <Avatar className="h-8 w-8">
                                        <AvatarFallback className="brand-gradient text-xs text-white">
                                            {initials}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="hidden text-left sm:block">
                                        <p className="max-w-[140px] truncate text-sm font-medium leading-tight">{session?.user?.name}</p>
                                        <p className="text-xs text-muted-foreground">{userRole.replace('_', ' ')}</p>
                                    </div>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{session?.user?.email}</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem asChild className="cursor-pointer">
                                    <Link href="/profile" className="flex w-full items-center">
                                        <Shield className="mr-2 h-4 w-4" /> {t('Profile')}
                                    </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onSelect={(event) => {
                                        // Take signout off Radix's select/focus-return path and send
                                        // it straight to the sign-in page. The default callbackUrl is
                                        // the current protected route, which bounces through an extra
                                        // redirect and makes the first click look like it did nothing.
                                        event.preventDefault();
                                        void signOut({ callbackUrl: '/auth/signin' });
                                    }}
                                    className="cursor-pointer text-red-500 focus:text-red-500"
                                >
                                    <LogOut className="mr-2 h-4 w-4" />
                                    <span>{t('Sign out')}</span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </header>

                {/* Page content */}
                <main className="flex-1 overflow-y-auto">
                    <div className="container max-w-7xl py-6 md:py-8">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}
