import { Role } from '@prisma/client';
import { z } from 'zod';

export const strongPasswordSchema = z.string()
    .min(12, 'Password must contain at least 12 characters')
    .max(128, 'Password must contain at most 128 characters')
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[0-9]/, 'Password must contain a number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain a symbol');

const userNameSchema = z.string().trim().min(1, 'Name is required').max(100);
const userEmailSchema = z.string().trim().email().max(254);

export const createUserSchema = z.object({
    name: userNameSchema,
    email: userEmailSchema,
    role: z.nativeEnum(Role).default(Role.USER),
    password: strongPasswordSchema.optional(),
}).strict();

export const updateUserSchema = z.object({
    userId: z.string().uuid(),
    role: z.nativeEnum(Role).optional(),
    name: userNameSchema.optional(),
    email: userEmailSchema.optional(),
    isActive: z.boolean().optional(),
    queueIds: z.array(z.string().uuid()).max(100).optional(),
    resetPassword: z.boolean().optional(),
    password: strongPasswordSchema.optional(),
}).strict().refine(
    (value) => Object.keys(value).some((key) => key !== 'userId'),
    { message: 'At least one user change is required' }
).refine(
    (value) => !(value.resetPassword && value.password),
    { message: 'Choose either a generated password reset or an explicit password', path: ['password'] }
).refine(
    (value) => !value.queueIds || new Set(value.queueIds).size === value.queueIds.length,
    { message: 'Department assignments must be unique', path: ['queueIds'] }
);

export const deactivateUserSchema = z.object({
    id: z.string().uuid(),
}).strict();