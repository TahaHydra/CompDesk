'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
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
} from 'lucide-react';
import { useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { formatDistanceToNow } from 'date-fns';

const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN'] },
    { href: '/tickets', label: 'My Tickets', icon: Ticket, roles: ['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN'] },
    { href: '/tickets/new', label: 'New Ticket', icon: Plus, roles: ['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN'] },
    { href: '/queue', label: 'Department Inbox', icon: Inbox, roles: ['AGENT', 'ADMIN', 'SUPER_ADMIN'] },
];

const adminItems = [
    { href: '/admin/departments', label: 'Departments', icon: FolderKanban },
    { href: '/admin/templates', label: 'Templates', icon: FileText },
    { href: '/admin/categories', label: 'Categories', icon: Tags },
    { href: '/admin/tags', label: 'Tags', icon: Tag },
    { href: '/admin/users', label: 'Users', icon: Users },
    { href: '/admin/logs', label: 'Logs', icon: FileText },
    { href: '/admin/settings', label: 'Settings', icon: Settings },
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

export default function AppShell({ children }: { children: React.ReactNode }) {
    const { data: session } = useSession();
    const pathname = usePathname();
    const router = useRouter();
    const queryClient = useQueryClient();
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [notifOpen, setNotifOpen] = useState(false);

    const userRole = session?.user?.role ?? 'USER';
    const isAdminUser = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN';
    const initials = session?.user?.name?.split(' ').map(n => n[0]).join('').toUpperCase() ?? '?';

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

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            {/* Sidebar */}
            <aside
                className={cn(
                    'relative flex flex-col border-r bg-card transition-all duration-300 ease-in-out',
                    sidebarOpen ? 'w-64' : 'w-16'
                )}
            >
                {/* Logo */}
                <Link href="/dashboard" className="flex h-16 items-center gap-3 border-b px-4 hover:bg-accent/50 transition-colors">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 shadow-md">
                        <Shield className="h-5 w-5 text-white" />
                    </div>
                    {sidebarOpen && (
                        <div className="animate-fade-in">
                            <h1 className="text-lg font-bold gradient-text">CompDesk</h1>
                            <p className="text-[10px] text-muted-foreground -mt-0.5">Helpdesk</p>
                        </div>
                    )}
                </Link>

                {/* Nav */}
                <ScrollArea className="flex-1 px-3 py-4">
                    <nav className="space-y-1">
                        {navItems
                            .filter((item) => item.roles.includes(userRole))
                            .map((item) => (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={cn(
                                        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
                                        pathname === item.href || pathname.startsWith(item.href + '/')
                                            ? 'bg-primary/10 text-primary shadow-sm'
                                            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                                    )}
                                >
                                    <item.icon className={cn('h-4.5 w-4.5 shrink-0', !sidebarOpen && 'mx-auto')} />
                                    {sidebarOpen && <span className="animate-fade-in">{item.label}</span>}
                                </Link>
                            ))}
                    </nav>

                    {isAdminUser && sidebarOpen && (
                        <>
                            <Separator className="my-4" />
                            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Admin
                            </p>
                            <nav className="space-y-1">
                                {adminItems.map((item) => (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={cn(
                                            'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
                                            pathname.startsWith(item.href)
                                                ? 'bg-primary/10 text-primary shadow-sm'
                                                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                                        )}
                                    >
                                        <item.icon className="h-4.5 w-4.5 shrink-0" />
                                        <span>{item.label}</span>
                                    </Link>
                                ))}
                            </nav>
                        </>
                    )}
                </ScrollArea>

                {/* Collapse button */}
                <button
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className="absolute -right-3 top-20 flex h-6 w-6 items-center justify-center rounded-full border bg-background shadow-sm hover:bg-accent transition-transform"
                >
                    <ChevronLeft className={cn('h-3 w-3 transition-transform', !sidebarOpen && 'rotate-180')} />
                </button>
            </aside>

            {/* Main content */}
            <div className="flex flex-1 flex-col overflow-hidden">
                {/* Top bar */}
                <header className="flex h-16 items-center justify-between border-b bg-card/50 backdrop-blur-sm px-6">
                    <div className="flex items-center gap-4">
                        <button
                            className="lg:hidden"
                            onClick={() => setSidebarOpen(!sidebarOpen)}
                        >
                            <Menu className="h-5 w-5" />
                        </button>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search tickets..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-80 pl-9 h-9 bg-muted/50"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && searchQuery.trim()) {
                                        router.push(`/tickets?search=${encodeURIComponent(searchQuery.trim())}`);
                                    }
                                }}
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <ThemeToggle />
                        <Popover open={notifOpen} onOpenChange={setNotifOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="ghost" size="icon" className="relative">
                                    <Bell className="h-4.5 w-4.5" />
                                    {unreadCount > 0 && (
                                        <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500 animate-pulse-dot" />
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-96 p-0">
                                <div className="flex items-center justify-between px-4 py-3 border-b">
                                    <h3 className="font-semibold text-sm">Notifications</h3>
                                    {unreadCount > 0 && (
                                        <Button variant="ghost" size="sm" className="text-xs h-7 text-primary" onClick={markAllRead}>
                                            Mark all read
                                        </Button>
                                    )}
                                </div>
                                <ScrollArea className="max-h-80">
                                    {(!notifications?.items || notifications.items.length === 0) ? (
                                        <div className="flex flex-col items-center justify-center py-10 text-center">
                                            <Bell className="h-8 w-8 text-muted-foreground/40 mb-2" />
                                            <p className="text-sm text-muted-foreground">No notifications yet</p>
                                            <p className="text-xs text-muted-foreground/70 mt-1">Activity on your tickets will show up here</p>
                                        </div>
                                    ) : (
                                        <div className="divide-y">
                                            {notifications.items.map((n: any) => (
                                                <Link
                                                    key={n.id}
                                                    href={`/tickets/${n.ticketId}`}
                                                    onClick={() => setNotifOpen(false)}
                                                    className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                                                >
                                                    <div className="mt-0.5 shrink-0">{notificationIcon(n.type)}</div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium truncate">{n.ticketKey}: {n.ticketTitle}</p>
                                                        <p className="text-xs text-muted-foreground truncate">{n.content || n.type.replace(/_/g, ' ').toLowerCase()}</p>
                                                        <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                                                            {n.userName} · {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
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
                                <Button variant="ghost" className="flex items-center gap-2 h-auto p-1.5">
                                    <Avatar className="h-8 w-8">
                                        <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-xs">
                                            {initials}
                                        </AvatarFallback>
                                    </Avatar>
                                    {sidebarOpen && (
                                        <div className="text-left hidden sm:block">
                                            <p className="text-sm font-medium">{session?.user?.name}</p>
                                            <p className="text-xs text-muted-foreground">{userRole}</p>
                                        </div>
                                    )}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuLabel>{session?.user?.email}</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem asChild className="cursor-pointer">
                                    <Link href="/profile" className="flex items-center w-full">
                                        <Shield className="mr-2 h-4 w-4" /> Profile
                                    </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => signOut()} className="cursor-pointer">
                                    <LogOut className="mr-2 h-4 w-4 text-red-500" />
                                    <span className="text-red-500">Sign out</span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </header>

                {/* Page content */}
                <main className="flex-1 overflow-y-auto">
                    <div className="container py-6 max-w-7xl animate-slide-in">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}
