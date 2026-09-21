'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { PageHeader } from '@/components/layout/page-header';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Shield, Plus, Search, Copy, Check, RotateCcw, Trash2, Pencil, UserPlus, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuCheckboxItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { copyText } from '@/lib/browser-clipboard';

export default function AdminUsersPage() {
    const { toast } = useToast();
    const { data: session } = useSession();
    const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN';
    const roleOptions = isSuperAdmin ? ['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN'] : ['USER', 'AGENT', 'ADMIN'];
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState('');
    const [createOpen, setCreateOpen] = useState(false);
    const [editUser, setEditUser] = useState<any>(null);
    const [deleteUser, setDeleteUser] = useState<any>(null);
    const [generatedPassword, setGeneratedPassword] = useState('');
    const [passwordCopied, setPasswordCopied] = useState(false);

    // Create form state
    const [newName, setNewName] = useState('');
    const [newEmail, setNewEmail] = useState('');
    const [newRole, setNewRole] = useState('USER');

    // Edit form state
    const [editName, setEditName] = useState('');
    const [editEmail, setEditEmail] = useState('');
    const [editRole, setEditRole] = useState('');
    const [editActive, setEditActive] = useState(true);

    const { data: users, isLoading, error: usersError } = useQuery({
        queryKey: ['users'],
        queryFn: async () => {
            const res = await fetch('/api/users');
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Failed to load users');
            return payload;
        },
    });

    const { data: queues, error: queuesError } = useQuery({
        queryKey: ['queues'],
        queryFn: async () => {
            const res = await fetch('/api/queues');
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Failed to load departments');
            return payload;
        },
    });

    const createUser = useMutation({
        mutationFn: async () => {
            const res = await fetch('/api/users', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName, email: newEmail, role: newRole }),
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
            return res.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            setCreateOpen(false);
            setNewName(''); setNewEmail(''); setNewRole('USER');
            setGeneratedPassword(data.generatedPassword);
            toast({ title: 'User created successfully' });
        },
        onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
    });

    const updateUser = useMutation({
        mutationFn: async (data: any) => {
            const res = await fetch('/api/users', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
            return res.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            if (data.generatedPassword) {
                setGeneratedPassword(data.generatedPassword);
            }
            setEditUser(null);
            toast({ title: 'User updated' });
        },
        onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
    });

    const deleteUserMutation = useMutation({
        mutationFn: async (id: string) => {
            const res = await fetch(`/api/users?id=${id}`, { method: 'DELETE' });
            if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
            return res.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            setDeleteUser(null);
            toast({ title: 'User deactivated', description: data.message });
        },
        onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
    });

    const resetPassword = useMutation({
        mutationFn: async (userId: string) => {
            const res = await fetch('/api/users', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, resetPassword: true }),
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
            return res.json();
        },
        onSuccess: (data) => {
            if (data.generatedPassword) setGeneratedPassword(data.generatedPassword);
            toast({ title: 'Password reset successfully' });
        },
    });

    const copyPassword = async () => {
        const copied = await copyText(generatedPassword);
        setPasswordCopied(copied);
        if (copied) setTimeout(() => setPasswordCopied(false), 2000);
        else toast({ title: 'Copy unavailable', description: 'Select the displayed password and copy it manually.', variant: 'destructive' });
    };

    const filteredUsers = (users ?? []).filter((u: any) =>
        !searchQuery || u.name?.toLowerCase().includes(searchQuery.toLowerCase()) || u.email?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const openEditDialog = (u: any) => {
        setEditUser(u);
        setEditName(u.name);
        setEditEmail(u.email);
        setEditRole(u.role);
        setEditActive(u.isActive);
    };

    const roleBadge = (role: string) => {
        const colors: Record<string, string> = {
            SUPER_ADMIN: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
            ADMIN: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
            AGENT: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
            USER: 'bg-gray-100 text-gray-800 dark:bg-gray-800/30 dark:text-gray-400',
        };
        return <Badge className={`text-xs font-medium ${colors[role] || ''}`}>{role.replace('_', ' ')}</Badge>;
    };

    if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading users...</div>;
    if (usersError || queuesError) {
        const message = usersError instanceof Error ? usersError.message : queuesError instanceof Error ? queuesError.message : 'Failed to load user management';
        return <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center text-destructive">{message}</div>;
    }

    return (
        <div className="space-y-6">
            <PageHeader
                icon={Shield}
                title="User Management"
                description={`${filteredUsers.length} users · Create, edit, and manage user accounts`}
            >
                <Button onClick={() => setCreateOpen(true)} className="gap-2">
                    <UserPlus className="h-4 w-4" /> Create User
                </Button>
            </PageHeader>

            {/* Search */}
            <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search by name or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                />
            </div>

            {/* User Cards */}
            <div className="grid grid-cols-1 gap-3">
                {filteredUsers.map((u: any) => {
                    const canManageUser = isSuperAdmin || u.role !== 'SUPER_ADMIN';
                    const assignedQueueIds = u.queueMemberships?.map((m: any) => m.queueId) || [];
                    return (
                        <Card key={u.id} className={`border shadow-sm transition-colors ${!u.isActive ? 'opacity-60 border-dashed' : ''}`}>
                            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-semibold text-base truncate">{u.name}</p>
                                        {roleBadge(u.role)}
                                        {!u.isActive && <Badge variant="outline" className="text-xs text-red-500 border-red-300">Deactivated</Badge>}
                                        <Badge variant="outline" className="text-xs">
                                            {u.loginMethod === 'SSO' ? '🔐 SSO' : '🔑 Local'}
                                        </Badge>
                                    </div>
                                    <p className="text-sm text-muted-foreground mt-0.5">{u.email}</p>
                                    {assignedQueueIds.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-2">
                                            {assignedQueueIds.map((qid: string) => {
                                                const qName = queues?.find((q: any) => q.id === qid)?.name || 'Unknown';
                                                return <Badge key={qid} variant="outline" className="text-xs bg-accent">{qName}</Badge>;
                                            })}
                                        </div>
                                    )}
                                </div>

                                <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                                    {/* Quick role change */}
                                    <Select
                                        value={u.role}
                                        disabled={!canManageUser || u.id === session?.user?.id}
                                        onValueChange={(role) => updateUser.mutate({ userId: u.id, role })}
                                    >
                                        <SelectTrigger className="w-[130px] h-8 text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {roleOptions.map((r) => (
                                                <SelectItem key={r} value={r}>{r.replace('_', ' ')}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>

                                    {/* Department assignment (for agents+) */}
                                    {canManageUser && (u.role === 'AGENT' || u.role === 'ADMIN' || u.role === 'SUPER_ADMIN') && (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="outline" size="sm" className="h-8 text-xs">
                                                    {assignedQueueIds.length === 0 ? 'No Dept' : `${assignedQueueIds.length} Dept`}
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent className="w-[200px]" align="end">
                                                {(queues ?? []).map((q: any) => {
                                                    const isAssigned = assignedQueueIds.includes(q.id);
                                                    return (
                                                        <DropdownMenuCheckboxItem
                                                            key={q.id}
                                                            checked={isAssigned}
                                                            onCheckedChange={(checked) => {
                                                                const newIds = checked
                                                                    ? [...assignedQueueIds, q.id]
                                                                    : assignedQueueIds.filter((id: string) => id !== q.id);
                                                                updateUser.mutate({ userId: u.id, queueIds: newIds });
                                                            }}
                                                        >
                                                            {q.name}
                                                        </DropdownMenuCheckboxItem>
                                                    );
                                                })}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    )}

                                    {/* Action buttons */}
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(u)} disabled={!canManageUser} title="Edit user">
                                        <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => resetPassword.mutate(u.id)} disabled={!canManageUser} title="Reset password">
                                        <RotateCcw className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteUser(u)} disabled={!canManageUser || u.id === session?.user?.id} title="Deactivate user">
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {/* Create User Dialog */}
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5" /> Create New User</DialogTitle>
                        <DialogDescription>Create a local account. A secure password will be auto-generated.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Full Name</Label>
                            <Input placeholder="Jean Dupont" value={newName} onChange={(e) => setNewName(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Email</Label>
                            <Input placeholder="user@example.com" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Role</Label>
                            <Select value={newRole} onValueChange={setNewRole}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {roleOptions.map((r) => (
                                        <SelectItem key={r} value={r}>{r.replace('_', ' ')}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                        <Button onClick={() => createUser.mutate()} disabled={!newName || !newEmail || createUser.isPending} className="gap-2">
                            <Plus className="h-4 w-4" /> Create
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit User Dialog */}
            <Dialog open={!!editUser} onOpenChange={() => setEditUser(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2"><Pencil className="h-5 w-5" /> Edit User</DialogTitle>
                        <DialogDescription>Modify user details.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Full Name</Label>
                            <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Email</Label>
                            <Input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Role</Label>
                            <Select value={editRole} onValueChange={setEditRole}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {roleOptions.map((r) => (
                                        <SelectItem key={r} value={r}>{r.replace('_', ' ')}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg border">
                            <div>
                                <p className="text-sm font-medium">Active Account</p>
                                <p className="text-xs text-muted-foreground">Deactivated users cannot log in</p>
                            </div>
                            <Switch checked={editActive} onCheckedChange={setEditActive} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
                        <Button onClick={() => updateUser.mutate({
                            userId: editUser?.id, name: editName, email: editEmail, role: editRole, isActive: editActive,
                        })} disabled={updateUser.isPending}>
                            Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Deactivation confirmation */}
            <AlertDialog open={!!deleteUser} onOpenChange={() => setDeleteUser(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-destructive" /> Deactivate User
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Deactivate <strong>{deleteUser?.name}</strong> ({deleteUser?.email})?
                            Their history will be retained, existing sessions will be revoked, and the account can be reactivated later.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={deleteUserMutation.isPending}
                            onClick={() => deleteUserMutation.mutate(deleteUser?.id)}
                        >
                            {deleteUserMutation.isPending ? 'Deactivating…' : 'Yes, deactivate'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Generated Password Display */}
            <Dialog open={!!generatedPassword} onOpenChange={() => { setGeneratedPassword(''); setPasswordCopied(false); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">🔑 Generated Password</DialogTitle>
                        <DialogDescription>
                            This password is shown only once. Copy it now and share it securely with the user.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex items-center gap-2 p-3 bg-muted rounded-lg border font-mono text-lg">
                        <span className="flex-1 select-all">{generatedPassword}</span>
                        <Button variant="ghost" size="icon" onClick={copyPassword}>
                            {passwordCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                        </Button>
                    </div>
                    <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                        <p className="text-xs text-amber-800 dark:text-amber-200">
                            This password cannot be retrieved later. If lost, use the <strong>Reset Password</strong> button to generate a new one.
                        </p>
                    </div>
                    <DialogFooter>
                        <Button onClick={() => { setGeneratedPassword(''); setPasswordCopied(false); }}>Done</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
