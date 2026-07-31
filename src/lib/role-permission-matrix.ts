export const ROLE_PERMISSION_MATRIX = {
    USER: {
        ticketScope: 'own',
        internalNotes: false,
        departmentAdministration: 'none',
        globalSettings: false,
        auditLogs: false,
        permanentTicketDeletion: false,
    },
    AGENT: {
        ticketScope: 'assigned_departments',
        internalNotes: true,
        departmentAdministration: 'none',
        globalSettings: false,
        auditLogs: false,
        permanentTicketDeletion: false,
    },
    ADMIN: {
        ticketScope: 'administered_or_assigned_departments',
        internalNotes: true,
        departmentAdministration: 'administered_departments',
        globalSettings: false,
        auditLogs: false,
        permanentTicketDeletion: false,
    },
    SUPER_ADMIN: {
        ticketScope: 'global',
        internalNotes: true,
        departmentAdministration: 'global',
        globalSettings: true,
        auditLogs: true,
        permanentTicketDeletion: true,
    },
} as const;