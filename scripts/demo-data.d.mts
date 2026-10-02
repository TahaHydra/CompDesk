import type { Prisma, PrismaClient } from '@prisma/client';
export interface DemoCredentials { accounts: Array<{ email: string; name: string; role: string }>; password: string }
export interface DemoState { installed: boolean; managed: boolean; accounts: number; tickets: number; installedAt: string | null }
export interface DemoRemoval { removed: number; retained: number; deactivated: number; attachments: Array<{ path: string; ticketId: string }> }
export const DEMO_CONFIRMATION: string;
export const DEMO_LEDGER_KEY: string;
export function getDemoState(client: PrismaClient): Promise<DemoState>;
export function installDemoData(client: PrismaClient, options?: { protectedUserId?: string; domain?: string; password?: string; emails?: Array<string | undefined> }): Promise<DemoCredentials>;
export function installDemoDataInTransaction(client: Prisma.TransactionClient, options?: { protectedUserId?: string; domain?: string; password?: string }): Promise<DemoCredentials>;
export function removeDemoData(client: PrismaClient, options: { protectedUserId?: string; confirmation: string }): Promise<DemoRemoval>;
export function parseDemoLedger(value: string): { version: number; installedAt: string; records: Record<string, string[]> } | null;
