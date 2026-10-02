import { translate } from '@/lib/i18n';
test.each([
    ['Remind me', 'Me rappeler'],
    ['Ticket reminder', 'Rappel de ticket'],
    ['Internal', 'Interne'],
    ['Assignees', 'Personnes assignées'],
    ['Routing options could not be loaded', 'Les options d’orientation n’ont pas pu être chargées'],
    ['Email delivery provider', 'Fournisseur d’envoi des e-mails'],
    ['Sender mailbox', 'Boîte expéditrice'],
    ['Pending User', 'En attente de l’utilisateur'],
])('audited UI translates %s while preserving English', (key, french) => {
    expect(translate('fr', key)).toBe(french);
    expect(translate('en', key)).toBe(key);
});
