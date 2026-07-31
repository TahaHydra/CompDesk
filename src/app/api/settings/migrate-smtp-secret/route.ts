import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { encryptSettingSecret, isEncryptedSettingSecret, SettingsSecretError } from '@/lib/settings-secret';

export async function POST() {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const setting = await prisma.appSetting.findUnique({ where: { key: 'smtp_password' } });
        if (!setting?.value) return NextResponse.json({ success: true, migrated: false, message: 'No database SMTP password requires migration.' });
        if (isEncryptedSettingSecret(setting.value)) return NextResponse.json({ success: true, migrated: false, message: 'The SMTP password is already encrypted.' });
        await prisma.appSetting.update({ where: { key: 'smtp_password' }, data: { value: encryptSettingSecret(setting.value) } });
        await auditLog({ userId: session.user.id, action: 'smtp.password_migrated', entity: 'app_setting', metadata: { envelope: 'enc:v1' } });
        return NextResponse.json({ success: true, migrated: true, message: 'The existing SMTP password was encrypted successfully.' });
    } catch (error) {
        if (error instanceof SettingsSecretError) return NextResponse.json({ error: error.message }, { status: 409 });
        return NextResponse.json({ error: 'SMTP password migration failed' }, { status: 500 });
    }
}