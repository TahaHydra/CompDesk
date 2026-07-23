'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FileText, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/layout/page-header';

type AuditLog = {
    id: string;
    action: string;
    entity: string;
    entityId: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    metadata: unknown;
    createdAt: string;
    user: { id: string; name: string; email: string } | null;
};

type AuditLogResponse = {
    logs: AuditLog[];
    pagination: { total: number; page: number; limit: number; totalPages: number };
};

export default function AdminLogsPage() {
    const [page, setPage] = useState(1);
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');

    const { data, isLoading, error } = useQuery<AuditLogResponse>({
        queryKey: ['audit-logs', page, search],
        queryFn: async () => {
            const params = new URLSearchParams({ page: String(page), limit: '50' });
            if (search) params.set('search', search);
            const response = await fetch(`/api/audit-logs?${params}`);
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                throw new Error(body?.error || 'Unable to load audit logs');
            }
            return response.json();
        },
    });

    const submitSearch = (event: React.FormEvent) => {
        event.preventDefault();
        setPage(1);
        setSearch(searchInput.trim());
    };

    return (
        <div className="space-y-6">
            <PageHeader
                icon={FileText}
                title="Audit Logs"
                description="Review authentication and administrative activity."
            />

            <form onSubmit={submitSearch} className="flex max-w-xl gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={searchInput}
                        onChange={(event) => setSearchInput(event.target.value)}
                        placeholder="Search action, entity, or IP address..."
                        className="pl-9"
                    />
                </div>
                <Button type="submit">Search</Button>
            </form>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg">
                        Activity {data ? `(${data.pagination.total})` : ''}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {isLoading && <div className="p-8 text-center text-muted-foreground">Loading logs...</div>}
                    {error && <div className="p-8 text-center text-destructive">{error.message}</div>}
                    {!isLoading && !error && data?.logs.length === 0 && (
                        <div className="p-8 text-center text-muted-foreground">No audit activity found.</div>
                    )}
                    {!isLoading && !error && data && data.logs.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="border-y bg-muted/40 text-left text-muted-foreground">
                                    <tr>
                                        <th className="px-4 py-3 font-medium">Date</th>
                                        <th className="px-4 py-3 font-medium">Action</th>
                                        <th className="px-4 py-3 font-medium">User</th>
                                        <th className="px-4 py-3 font-medium">Entity</th>
                                        <th className="px-4 py-3 font-medium">IP address</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {data.logs.map((log) => (
                                        <tr key={log.id} className="hover:bg-muted/20">
                                            <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                                                {new Date(log.createdAt).toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3"><Badge variant="secondary">{log.action}</Badge></td>
                                            <td className="px-4 py-3">
                                                {log.user ? (
                                                    <div>
                                                        <div className="font-medium">{log.user.name}</div>
                                                        <div className="text-xs text-muted-foreground">{log.user.email}</div>
                                                    </div>
                                                ) : <span className="text-muted-foreground">System / anonymous</span>}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div>{log.entity}</div>
                                                {log.entityId && <div className="max-w-48 truncate text-xs text-muted-foreground">{log.entityId}</div>}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{log.ipAddress || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {data && data.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                        Page {data.pagination.page} of {data.pagination.totalPages}
                    </p>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                            <ChevronLeft className="mr-1 h-4 w-4" /> Previous
                        </Button>
                        <Button variant="outline" size="sm" disabled={page >= data.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>
                            Next <ChevronRight className="ml-1 h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
