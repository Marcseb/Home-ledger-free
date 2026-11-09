import { useI18n, type Locale } from '@/lib/i18n';

const dict = {
  en: {
    title: 'Invite a device', memberGuide: 'To add a device or person, ask the household Master to create an invitation.',
    intro: 'Create a single-use code that expires in 10 minutes. The server decides the role; the person joining cannot choose it.',
    newMember: 'New member', existing: 'Existing account', newName: 'New member name', newNamePh: 'Member name',
    target: 'Invite for', ownWarnTitle: 'Grant Master access?', ownWarn: 'This code lets the next device that redeems it act as Master on your own account.',
    create: 'Create invitation', creating: 'Creating…', cont: 'Continue', cancel: 'Cancel',
    needName: 'Enter the new member name.', needTarget: 'Choose an account.',
    codeTitle: 'Invitation code', codeNote: 'Shown once. It is not saved on this phone. Share it privately.', expires: 'Expires', hide: 'Hide code', share: 'Share code',
    shareMsg: 'Home Ledger invitation code (valid 10 minutes): ', listTitle: 'Invitations', refresh: 'Refresh', loading: 'Loading invitations…',
    none: 'No invitations yet.', loadErr: 'Could not load invitations.', createErr: 'Could not create invitation.', revokeErr: 'Could not revoke invitation.',
    revoke: 'Revoke', revokeQ: 'Revoke this invitation?', revokeBody: 'The code will stop working immediately.', offline: 'Connect to the server to manage invitations.',
    pending: 'Pending', redeemed: 'Redeemed', revoked: 'Revoked', expired: 'Expired', master: 'Master device', member: 'Member', forNew: 'New member', created: 'Created',
    you: 'you', retry: 'Try again.',
  },
  fr: {
    title: 'Inviter un appareil', memberGuide: 'Pour ajouter un appareil ou une personne, demandez au Master du foyer de créer une invitation.',
    intro: 'Créez un code à usage unique valable 10 minutes. Le serveur choisit le rôle ; la personne qui rejoint ne peut pas le choisir.',
    newMember: 'Nouveau membre', existing: 'Compte existant', newName: 'Nom du nouveau membre', newNamePh: 'Nom du membre',
    target: 'Inviter pour', ownWarnTitle: 'Accorder l’accès Master ?', ownWarn: 'Ce code permettra au prochain appareil qui l’utilise d’agir comme Master sur votre propre compte.',
    create: 'Créer l’invitation', creating: 'Création…', cont: 'Continuer', cancel: 'Annuler',
    needName: 'Saisissez le nom du nouveau membre.', needTarget: 'Choisissez un compte.',
    codeTitle: 'Code d’invitation', codeNote: 'Affiché une seule fois. Non enregistré sur ce téléphone. Partagez-le en privé.', expires: 'Expire', hide: 'Masquer le code', share: 'Partager le code',
    shareMsg: 'Code d’invitation Home Ledger (valable 10 minutes) : ', listTitle: 'Invitations', refresh: 'Actualiser', loading: 'Chargement des invitations…',
    none: 'Aucune invitation.', loadErr: 'Impossible de charger les invitations.', createErr: 'Impossible de créer l’invitation.', revokeErr: 'Impossible de révoquer l’invitation.',
    revoke: 'Révoquer', revokeQ: 'Révoquer cette invitation ?', revokeBody: 'Le code cessera de fonctionner immédiatement.', offline: 'Connectez-vous au serveur pour gérer les invitations.',
    pending: 'En attente', redeemed: 'Utilisée', revoked: 'Révoquée', expired: 'Expirée', master: 'Appareil Master', member: 'Membre', forNew: 'Nouveau membre', created: 'Créée',
    you: 'vous', retry: 'Réessayez.',
  },
  it: {
    title: 'Invita un dispositivo', memberGuide: 'Per aggiungere un dispositivo o una persona, chiedi al Master della famiglia di creare un invito.',
    intro: 'Crea un codice monouso valido 10 minuti. Il ruolo lo decide il server; chi si unisce non può sceglierlo.',
    newMember: 'Nuovo membro', existing: 'Account esistente', newName: 'Nome del nuovo membro', newNamePh: 'Nome del membro',
    target: 'Invita per', ownWarnTitle: 'Concedere accesso Master?', ownWarn: 'Questo codice permette al prossimo dispositivo che lo usa di agire come Master sul tuo account.',
    create: 'Crea invito', creating: 'Creazione…', cont: 'Continua', cancel: 'Annulla',
    needName: 'Inserisci il nome del nuovo membro.', needTarget: 'Scegli un account.',
    codeTitle: 'Codice di invito', codeNote: 'Mostrato una sola volta. Non salvato su questo telefono. Condividilo in privato.', expires: 'Scade', hide: 'Nascondi codice', share: 'Condividi codice',
    shareMsg: 'Codice di invito Home Ledger (valido 10 minuti): ', listTitle: 'Inviti', refresh: 'Aggiorna', loading: 'Caricamento inviti…',
    none: 'Nessun invito.', loadErr: 'Impossibile caricare gli inviti.', createErr: 'Impossibile creare l’invito.', revokeErr: 'Impossibile revocare l’invito.',
    revoke: 'Revoca', revokeQ: 'Revocare questo invito?', revokeBody: 'Il codice smetterà di funzionare subito.', offline: 'Connettiti al server per gestire gli inviti.',
    pending: 'In attesa', redeemed: 'Usato', revoked: 'Revocato', expired: 'Scaduto', master: 'Dispositivo Master', member: 'Membro', forNew: 'Nuovo membro', created: 'Creato',
    you: 'tu', retry: 'Riprova.',
  },
} as const;

export type InvKey = keyof typeof dict.en;
export function useInvT() {
  const { locale } = useI18n();
  const l: Locale = locale;
  return (key: InvKey): string => dict[l][key];
}

export const pairText = {
  en: { code: 'Invitation code', ph: 'xxxx xxxx xxxx xxxx xxxx', bad: 'Add a server address and the 20-character invitation code.', fail: 'Could not pair with this server.',
    demo: 'Demo household reset. On the trusted server PC run: pnpm --filter @workspace/api-server invite-master — then enter the invitation it returns here.', hint: 'Spaces and hyphens are ignored. The server decides your name and role.' },
  fr: { code: 'Code d’invitation', ph: 'xxxx xxxx xxxx xxxx xxxx', bad: 'Ajoutez l’adresse du serveur et le code d’invitation de 20 caractères.', fail: 'Impossible de s’associer à ce serveur.',
    demo: 'Foyer de démonstration réinitialisé. Sur le PC serveur de confiance, lancez : pnpm --filter @workspace/api-server invite-master — puis saisissez ici l’invitation obtenue.', hint: 'Espaces et tirets ignorés. Le serveur décide de votre nom et de votre rôle.' },
  it: { code: 'Codice di invito', ph: 'xxxx xxxx xxxx xxxx xxxx', bad: 'Aggiungi l’indirizzo del server e il codice di invito di 20 caratteri.', fail: 'Impossibile associarsi a questo server.',
    demo: 'Famiglia demo reimpostata. Sul PC server fidato esegui: pnpm --filter @workspace/api-server invite-master — poi inserisci qui l’invito ottenuto.', hint: 'Spazi e trattini sono ignorati. Il server decide nome e ruolo.' },
} as const;

const errs = {
  en: { session: 'This device session is no longer valid. Pair again.', master: 'Only the Master can manage invitations.', pending: 'A pending invitation already uses this name. Revoke it or choose another name.',
    dup: 'That name is already used in this household. Choose another name.', redeemed: 'This invitation was already used and cannot be revoked.', rate: 'Too many attempts. Wait a few minutes and try again.',
    code: 'This invitation code is invalid, expired, revoked, or already used. Ask the Master for a new one.', shareErr: 'Could not open sharing. Select the code and copy it instead.' },
  fr: { session: 'La session de cet appareil n’est plus valide. Associez-le à nouveau.', master: 'Seul le Master peut gérer les invitations.', pending: 'Une invitation en attente utilise déjà ce nom. Révoquez-la ou choisissez un autre nom.',
    dup: 'Ce nom est déjà utilisé dans ce foyer. Choisissez-en un autre.', redeemed: 'Cette invitation a déjà été utilisée et ne peut pas être révoquée.', rate: 'Trop de tentatives. Patientez quelques minutes puis réessayez.',
    code: 'Ce code d’invitation est invalide, expiré, révoqué ou déjà utilisé. Demandez-en un nouveau au Master.', shareErr: 'Impossible d’ouvrir le partage. Sélectionnez le code et copiez-le.' },
  it: { session: 'La sessione di questo dispositivo non è più valida. Associalo di nuovo.', master: 'Solo il Master può gestire gli inviti.', pending: 'Un invito in attesa usa già questo nome. Revocalo o scegli un altro nome.',
    dup: 'Questo nome è già usato in questa famiglia. Scegline un altro.', redeemed: 'Questo invito è già stato usato e non può essere revocato.', rate: 'Troppi tentativi. Attendi qualche minuto e riprova.',
    code: 'Questo codice di invito non è valido, è scaduto, revocato o già usato. Chiedine uno nuovo al Master.', shareErr: 'Impossibile aprire la condivisione. Seleziona il codice e copialo.' },
} as const;
export type InvErrKey = keyof typeof errs.en;
export const invErrText = (locale: Locale, key: InvErrKey) => errs[locale][key];

/** Maps known server messages to localized text; unknown messages are returned raw. */
export function localizeInvitationError(message: string, locale: Locale): string {
  const m = message.toLowerCase();
  const k: InvErrKey | null =
    /session is invalid|revoked session/.test(m) ? 'session'
    : /master role required|only the master/.test(m) ? 'master'
    : /pending invitation already uses/.test(m) ? 'pending'
    : /already (uses|exists|used by)|duplicate|name.*(taken|in use)/.test(m) && !/code/.test(m) ? 'dup'
    : /(redeemed|already used).*revok|cannot revoke|can't revoke|already redeemed/.test(m) ? 'redeemed'
    : /too many|rate limit|try again later/.test(m) ? 'rate'
    : /invitation (code )?(is )?(invalid|expired|no longer valid|not found)|invitation target|already used|revoked/.test(m) ? 'code'
    : null;
  return k ? errs[locale][k] : message;
}
