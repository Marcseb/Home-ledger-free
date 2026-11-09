import type { Locale } from '@/lib/i18n';

export type HelpSection = { title: string; body: string };
export type HelpTopic = {
  id: string;
  title: string;
  summary: string;
  sections: HelpSection[];
  guideRoute?: '/shared-goal-guide' | '/backup-recovery-guide';
  guideLabel?: string;
};

type Raw = { id: string; guide?: 'goal' | 'backup'; t: Record<Locale, [string, string, [string, string][]]> };

const raw: Raw[] = [
  { id: 'getting-started', t: {
    en: ['Getting started and invitations', 'Connect your phone to the Home Ledger server on your own PC.', [
      ['Your data stays home', 'Home Ledger runs on a server on your own PC. The phone app talks to that server; nothing is sent to a cloud service.'],
      ['Set up and invite', 'The first person taps Set up household to create the household as its Master. In Household, the Master creates a single-use invitation for a new member name or an existing account. It expires after 10 minutes. The invitee enters the server address and 20-character hexadecimal invitation code only; the server assigns the invited name and role. Names are not authentication.'],
      ['Add another device', 'To add a device to an existing member account, the Master creates an invitation for that account. For an extra device on the Master account, the Master must explicitly confirm the invitation. The code is shown once; copy it or use the device share menu to send it privately. The Master can review invitation status and revoke a pending invitation. Your phone must reach the PC to accept an invitation.'],
      ['After a restore', 'Restoring revokes every device session and pending invitation. See the backup and recovery guide to reconnect the Master first, then invite existing members again.']]],
    fr: ['Démarrage et invitations', 'Connectez votre téléphone au serveur Home Ledger de votre propre PC.', [
      ['Vos données restent chez vous', 'Home Ledger fonctionne sur un serveur de votre PC. L’application dialogue avec ce serveur ; rien n’est envoyé vers un service cloud.'],
      ['Configurer et inviter', 'La première personne touche Configurer le foyer pour le créer en tant que Master. Dans Foyer, le Master crée une invitation à usage unique pour un nouveau nom de membre ou un compte existant. Elle expire au bout de 10 minutes. La personne invitée saisit uniquement l’adresse du serveur et le code d’invitation hexadécimal de 20 caractères ; le serveur lui attribue le nom et le rôle. Les noms ne servent pas à authentifier.'],
      ['Ajouter un autre appareil', 'Pour ajouter un appareil au compte existant d’un membre, le Master crée une invitation pour ce compte. Pour ajouter un appareil au compte du Master, celui-ci doit confirmer explicitement l’invitation. Le code n’est affiché qu’une fois ; copiez-le ou utilisez le menu de partage de l’appareil pour l’envoyer en privé. Le Master peut consulter l’état des invitations et révoquer celles en attente. Le téléphone doit joindre le PC pour accepter une invitation.'],
      ['Après une restauration', 'La restauration révoque toutes les sessions d’appareil et les invitations en attente. Consultez le guide de sauvegarde et récupération pour reconnecter d’abord le Master, puis inviter à nouveau les membres existants.']]],
    it: ['Primi passi e inviti', 'Collega il telefono al server Home Ledger sul tuo PC.', [
      ['I dati restano a casa', 'Home Ledger gira su un server sul tuo PC. L’app dialoga con quel server; nulla viene inviato a un servizio cloud.'],
      ['Configura e invita', 'La prima persona tocca Configura casa per crearla come Master. In Casa, il Master crea un invito monouso per un nuovo nome membro o un account esistente. Scade dopo 10 minuti. La persona invitata inserisce solo l’indirizzo del server e il codice di invito esadecimale di 20 caratteri; il server assegna nome e ruolo. I nomi non autenticano.'],
      ['Aggiungi un altro dispositivo', 'Per aggiungere un dispositivo all’account esistente di un membro, il Master crea un invito per quell’account. Per aggiungere un dispositivo all’account del Master, il Master deve confermare esplicitamente l’invito. Il codice viene mostrato una sola volta: copialo o usa il menu di condivisione del dispositivo per inviarlo in privato. Il Master può controllare lo stato degli inviti e revocare quelli in attesa. Il telefono deve raggiungere il PC per accettare un invito.'],
      ['Dopo un ripristino', 'Il ripristino revoca tutte le sessioni dei dispositivi e gli inviti in attesa. Consulta la guida a backup e recupero per riconnettere prima il Master e poi invitare di nuovo i membri esistenti.']]] } },
  { id: 'home', t: {
    en: ['Home and account scopes', 'Read balances and recent activity for the household or for you.', [
      ['Scopes', 'Switch between shared household money and your personal accounts. Tap the active Personal selector to choose one account or all personal accounts. Personal views are private to you.'],
      ['Current balances', 'Future-dated activity stays in Activity but does not affect current money until its UTC ledger date. Available balance also includes due pending changes on this device; closing history uses saved entries and includes those changes after sync. Goal reservations are separate from cash and may exceed currently available money.'],
      ['Bank estimate', 'In Personal, tap Estimated bank cash to expand the estimate: your Home Ledger balance plus app-only transfers to Shared, minus Shared purchases attributed to your selected personal account(s). Every new Shared expense is automatically attributed to its creator’s active Main account for this estimate only. It does not debit a personal ledger or change Shared totals, and it is not live bank data. Keep the app and local server updated together.'],
      ['Spending and budgets', 'The category card separates a category’s share of monthly spending from its budget usage. Tap a category to see its monthly entries. When you select one personal account, its spending is shown but category budgets still cover all your personal accounts.'],
       ['Shared monthly overview', 'The Shared card keeps cash separate from progress: expenses are compared with the sum of enabled monthly category budgets, including rollover; goal contributions are compared with the suggested monthly plan based on opening goal progress and due dates. Accepted personal-goal mirrors count as goal progress, not extra Shared cash.'],
      ['Backup status', 'The Master can see backup warnings on Home and check the last successful server backup in Settings.']]],
    fr: ['Accueil et portées de comptes', 'Consultez soldes et activité récente du foyer ou de vous seul.', [
      ['Portées', 'Passez de l’argent partagé du foyer à vos comptes personnels. Touchez le sélecteur Personnel actif pour choisir un compte ou tous vos comptes. Les vues personnelles sont privées.'],
      ['Soldes actuels', 'Les écritures à date future restent dans Activité mais ne modifient les fonds actuels qu’à leur date UTC. Le solde disponible inclut aussi les modifications en attente déjà dues sur cet appareil ; l’historique utilise les écritures enregistrées et les inclut après synchronisation. Les réservations des objectifs sont distinctes des fonds et peuvent les dépasser.'],
        ['Estimation bancaire', 'Dans Personnel, touchez Liquidités bancaires estimées pour développer l’estimation : votre solde Home Ledger, plus les virements comptables vers Partagé, moins les achats partagés attribués au(x) compte(s) personnel(s) sélectionné(s). Chaque nouvelle dépense partagée est attribuée automatiquement au compte Principal actif de son auteur, uniquement pour cette estimation. Cela ne débite pas le compte personnel, ne modifie pas les totaux partagés et ne représente pas les données réelles d’une banque. Maintenez l’application et le serveur local à jour ensemble.'],
      ['Dépenses et budgets', 'La carte distingue la part des dépenses mensuelles d’une catégorie et son utilisation du budget. Touchez une catégorie pour voir ses opérations du mois. Un compte personnel sélectionné limite les dépenses affichées, mais les budgets couvrent toujours tous vos comptes personnels.'],
       ['Vue mensuelle partagée', 'La carte partagée distingue les fonds et la progression : les dépenses sont comparées aux budgets mensuels actifs, reports compris ; les contributions aux objectifs sont comparées au plan mensuel conseillé selon la progression en début de mois et les échéances. Les contributions personnelles reportées ne sont pas des fonds partagés supplémentaires.'],
      ['État des sauvegardes', 'Le responsable voit les alertes de sauvegarde sur l’accueil et vérifie la dernière sauvegarde serveur réussie dans Paramètres.']]],
    it: ['Home e ambiti dei conti', 'Consulta saldi e attività recente della casa o personali.', [
      ['Ambiti', 'Passa dal denaro condiviso della casa ai tuoi conti personali. Tocca il selettore Personale attivo per scegliere un conto o tutti i conti. Le viste personali sono private.'],
      ['Saldi attuali', 'I movimenti con data futura restano in Attività ma non modificano il denaro attuale fino alla loro data UTC. Il saldo disponibile include anche le modifiche in attesa già dovute su questo dispositivo; lo storico usa i movimenti salvati e le include dopo la sincronizzazione. Le riserve per gli obiettivi sono separate dai fondi e possono superarli.'],
        ['Stima bancaria', 'In Personale, tocca Liquidità bancaria stimata per aprire il dettaglio: saldo Home Ledger, più i trasferimenti contabili a Condiviso, meno gli acquisti condivisi attribuiti ai conti personali selezionati. Ogni nuova spesa condivisa viene attribuita automaticamente al conto Principale attivo di chi la inserisce, solo per questa stima. Non addebita il saldo personale, non modifica i totali condivisi e non è un dato bancario in tempo reale. Mantieni aggiornati insieme app e server locale.'],
      ['Spese e budget', 'La scheda distingue la quota delle spese mensili di una categoria dall’utilizzo del budget. Tocca una categoria per vedere i movimenti del mese. Se selezioni un conto personale, le spese mostrate riguardano quel conto, ma i budget coprono sempre tutti i tuoi conti personali.'],
       ['Panoramica mensile condivisa', 'La scheda distingue denaro e progresso: le spese sono confrontate con i budget mensili attivi, riporti inclusi; i contributi agli obiettivi con il piano mensile suggerito in base al progresso a inizio mese e alle scadenze. I contributi personali riportati non sono denaro condiviso aggiuntivo.'],
      ['Stato dei backup', 'Il responsabile vede gli avvisi nella Home e può verificare l’ultimo backup server riuscito in Impostazioni.']]] } },
  { id: 'activity', t: {
    en: ['Activity and corrections', 'Expenses, income, transfers, and how mistakes are fixed.', [
      ['Entry types', 'Activity lists expenses, income, and transfers between your accounts.'],
      ['Shared purchases and settlement', 'Shared expenses reduce Shared only. New purchases are automatically attributed to the creator’s active Main account for the bank estimate; no payer field is required. Personal balances do not change for individual Shared purchases. Record a separate Main-to-Shared transfer when you settle at the end of the month. The app records ledger movements, not bank payments.'],
       ['Personal bank estimate', 'Older Shared expenses are not attributed retroactively. To include one you created, open it in Activity and save with Main preselected. Opening or cancelling the edit does not save a change.'],
      ['Audit adjustments', 'Updating the server retires saved automatic purchase funding with audited counter-entries: personal money is restored and Shared carries the purchase. The original purchase and its shares remain intact. Adjustments retain the original ledger date, while the server audit records when the upgrade ran. In Activity, Show audit entries reveals read-only funding history, adjustments, and cancelled or replaced entries. Hiding them never changes balances. Update both the app and local server.'],
      ['Corrections keep history', 'Correct a wrong amount or reverse an entry from Activity. The original is never silently deleted or rewritten; the audit trail stays intact.'],
      ['Reversed entries', 'A reversed original no longer counts in totals, budgets, or goal progress. Reversing a transfer-backed goal contribution updates the goal once.']]],
    fr: ['Activité et corrections', 'Dépenses, revenus, virements et correction des erreurs.', [
      ['Types d’écritures', 'L’activité liste les dépenses, revenus et virements entre vos comptes.'],
      ['Achats partagés et régularisation', 'Les dépenses partagées réduisent uniquement le compte Partagé. Les nouvelles dépenses sont attribuées automatiquement au compte Principal actif de leur auteur pour l’estimation bancaire ; aucun champ de paiement n’est requis. Les soldes personnels ne changent pas pour chaque achat partagé. Enregistrez un virement séparé du compte Principal vers Partagé lors de la régularisation en fin de mois. L’application enregistre les écritures, sans effectuer de paiement bancaire.'],
        ['Estimation bancaire personnelle', 'Les anciennes dépenses partagées ne sont pas attribuées rétroactivement. Pour inclure une dépense que vous avez créée, ouvrez-la dans Activité et enregistrez-la avec Principal présélectionné. Ouvrir ou annuler la modification ne l’enregistre pas.'],
      ['Ajustements d’audit', 'La mise à jour du serveur neutralise les anciens financements automatiques par des contre-écritures auditées : les fonds personnels sont rétablis et Partagé supporte l’achat. L’achat et ses quotes-parts sont conservés. Les ajustements gardent la date comptable d’origine ; l’audit serveur consigne la date de mise à jour. Dans Activité, Afficher les écritures d’audit révèle l’historique de financement en lecture seule, les ajustements et les écritures annulées ou remplacées. Les masquer ne change jamais les soldes. Mettez à jour l’application et le serveur local.'],
      ['Les corrections gardent l’historique', 'Corrigez un montant erroné ou annulez une écriture depuis l’activité. L’original n’est jamais supprimé ni réécrit discrètement ; la piste d’audit reste intacte.'],
      ['Écritures annulées', 'Un original annulé ne compte plus dans les totaux, budgets ou objectifs. Annuler une contribution adossée à un virement met l’objectif à jour une seule fois.']]],
    it: ['Attività e correzioni', 'Spese, entrate, trasferimenti e come correggere gli errori.', [
      ['Tipi di voci', 'L’attività elenca spese, entrate e trasferimenti tra i tuoi conti.'],
      ['Acquisti condivisi e conguaglio', 'Le spese condivise riducono solo il conto Condiviso. Le nuove spese vengono attribuite automaticamente al conto Principale attivo di chi le inserisce per la stima bancaria; non serve un campo di pagamento. I saldi personali non cambiano per ogni acquisto condiviso. Registra un trasferimento separato dal conto Principale a Condiviso per il conguaglio di fine mese. L’app registra movimenti contabili, non esegue pagamenti bancari.'],
      ['Stima bancaria personale', 'Le spese condivise precedenti non vengono attribuite retroattivamente. Per includere una spesa inserita da te, aprila in Attività e salvala con Principale preselezionato. Aprire o annullare la modifica non la salva.'],
      ['Rettifiche di audit', 'L’aggiornamento del server neutralizza i precedenti finanziamenti automatici con contromovimenti verificabili: il denaro personale viene ripristinato e Condiviso sostiene l’acquisto. L’acquisto e le quote rimangono intatti. Le rettifiche mantengono la data contabile originale; l’audit server registra quando è avvenuto l’aggiornamento. In Attività, Mostra le voci di audit visualizza lo storico di finanziamento in sola lettura, le rettifiche e le voci annullate o sostituite. Nasconderle non modifica mai i saldi. Aggiorna sia l’app sia il server locale.'],
      ['Le correzioni mantengono la storia', 'Correggi un importo sbagliato o storna una voce dall’attività. L’originale non viene cancellato né riscritto di nascosto; la traccia di audit resta intatta.'],
      ['Voci stornate', 'Un originale stornato non conta più in totali, budget o obiettivi. Stornare un contributo con trasferimento aggiorna l’obiettivo una sola volta.']]] } },
  { id: 'budgets', t: {
    en: ['Monthly category budgets', 'Set a monthly limit per category and track spending against it.', [
      ['How budgets work', 'Each budget is a monthly amount for one category. Spending in that category is compared with it during the month.'],
      ['What counts', 'Budget rules apply the full posted expense amount. Originals that were reversed are excluded. A budget tracks spending; it does not move or reserve money.'],
      ['Settings and warnings', 'The current limit and warning threshold carry into later months; past monthly settings and results remain in history. The Master manages shared budgets; you manage your personal budgets. Threshold alerts remain until dismissed.']]],
    fr: ['Budgets mensuels par catégorie', 'Fixez une limite mensuelle par catégorie et suivez vos dépenses.', [
      ['Fonctionnement', 'Chaque budget est un montant mensuel pour une catégorie. Les dépenses de cette catégorie y sont comparées pendant le mois.'],
      ['Ce qui compte', 'Le budget compte le montant total de la dépense enregistrée, hors originaux annulés. Il suit les dépenses sans déplacer ni réserver d’argent.'],
      ['Réglages et alertes', 'La limite et le seuil actuels se reportent aux mois suivants ; les mois passés restent dans l’historique. Le responsable gère les budgets partagés et vous gérez les vôtres. Les alertes restent jusqu’à leur fermeture.']]],
    it: ['Budget mensili per categoria', 'Imposta un limite mensile per categoria e segui le spese.', [
      ['Come funzionano', 'Ogni budget è un importo mensile per una categoria. Le spese di quella categoria vengono confrontate con esso durante il mese.'],
      ['Cosa conta', 'Il budget conta l’intero importo della spesa registrata, esclusi gli originali stornati. Tiene traccia delle spese senza spostare o riservare denaro.'],
      ['Impostazioni e avvisi', 'Il limite e la soglia attuali passano ai mesi successivi; i mesi precedenti restano nello storico. Il responsabile gestisce i budget condivisi e tu quelli personali. Gli avvisi restano finché non vengono chiusi.']]] } },
  { id: 'goals', guide: 'goal', t: {
    en: ['Savings goals', 'Personal and shared goals, contributions, and cancelling.', [
      ['Linked and unlinked', 'A linked personal goal transfers money from your Main account into its Savings account when you contribute. An unlinked goal only updates progress and moves no money.'],
      ['Shared goals', 'The Master creates a shared goal and assigns each member a quota. The member privately chooses whether to map it to a personal goal; that mapping is not visible to the Master. Shared progress can include mirrored personal contributions without moving that money into Shared.'],
      ['Home savings overview', 'Goals progress shows each goal’s total saved, target, remaining amount, due date, and required monthly pace. Below each goal, individual bars compare each person’s contribution with their accepted planned commitment. Personal goals use the owner’s goal target. People without an accepted commitment are labelled instead of receiving an assumed target. Mirrored progress is not additional account money.'],
      ['Cancel one contribution', 'Open the goal’s Contributions history and cancel your own entry while connected. This removes goal progress and any mirrored shared progress without moving money. Original transfers stay posted; money in Savings becomes unallocated. The cancelled entry remains in history.'],
      ['Cancelling', 'Cancelling keeps the goal as history. For personal goals the owner chooses whether to return transferred money to Main or leave it in Savings; for shared goals, transfer-backed funds stay pending for each contributing owner.']]],
    fr: ['Objectifs d’épargne', 'Objectifs personnels et partagés, contributions et annulation.', [
      ['Liés et non liés', 'Un objectif personnel lié transfère de l’argent de votre compte Principal vers son compte d’épargne à chaque contribution. Un objectif non lié met seulement à jour la progression et ne déplace aucun argent.'],
      ['Objectifs partagés', 'Le responsable crée l’objectif partagé et attribue un quota à chaque membre. Le membre choisit en privé de l’associer à un objectif personnel ; ce lien n’est pas visible du responsable. La progression partagée peut refléter des contributions personnelles sans transférer cet argent au compte partagé.'],
      ['Vue d’ensemble sur l’accueil', 'La progression des objectifs présente le total épargné, la cible, le montant restant, l’échéance et le rythme mensuel requis. Sous chaque objectif, des barres individuelles comparent la contribution de chaque personne à son engagement accepté. Pour un objectif personnel, la cible du propriétaire sert de référence. Sans engagement accepté, une indication remplace toute cible supposée. La progression reflétée n’est pas de l’argent supplémentaire.'],
      ['Annuler une contribution', 'Ouvrez l’historique des contributions de l’objectif et annulez votre propre écriture en étant connecté. La progression personnelle et partagée associée est retirée sans déplacer d’argent. Les virements restent enregistrés ; les fonds en épargne ne sont plus affectés. L’écriture annulée reste dans l’historique.'],
      ['Annulation', 'L’annulation conserve l’objectif dans l’historique. Pour un objectif personnel, le propriétaire choisit de remettre l’argent transféré sur le compte Principal ou de le laisser en épargne ; pour un objectif partagé, les fonds restent en attente pour chaque contributeur.']]],
    it: ['Obiettivi di risparmio', 'Obiettivi personali e condivisi, contributi e annullamento.', [
      ['Collegati e non collegati', 'Un obiettivo personale collegato trasferisce denaro dal tuo conto Principale al conto Risparmio quando contribuisci. Un obiettivo non collegato aggiorna solo l’avanzamento e non sposta denaro.'],
      ['Obiettivi condivisi', 'Il responsabile crea l’obiettivo condiviso e assegna una quota a ogni membro. Il membro sceglie in privato se associarla a un obiettivo personale; l’associazione non è visibile al responsabile. L’avanzamento condiviso può includere contributi personali riportati senza trasferire quel denaro nel conto condiviso.'],
      ['Panoramica nella Home', 'Avanzamento obiettivi mostra il totale risparmiato, il traguardo, l’importo rimanente, la scadenza e il ritmo mensile necessario. Sotto ogni obiettivo, barre individuali confrontano il contributo di ciascuna persona con il suo impegno accettato. Per gli obiettivi personali si usa il traguardo del proprietario. In assenza di un impegno accettato compare un’indicazione, senza presumere un traguardo. I progressi riportati non sono denaro aggiuntivo.'],
      ['Annullare un contributo', 'Apri la cronologia dei contributi dell’obiettivo e annulla un tuo movimento mentre sei connesso. Il progresso personale e condiviso associato viene rimosso senza spostare denaro. I trasferimenti restano registrati; i fondi nel Risparmio non sono più assegnati. Il contributo annullato rimane nella cronologia.'],
      ['Annullamento', 'L’annullamento conserva l’obiettivo come storico. Per gli obiettivi personali il proprietario sceglie se restituire il denaro trasferito al conto Principale o lasciarlo nel Risparmio; per quelli condivisi i fondi restano in sospeso per ogni contribuente.']]] } },
  { id: 'recurring', t: {
    en: ['Recurring entries', 'Entries that repeat on a schedule you define.', [
      ['Purpose', 'A recurring entry repeats an expense, income, or transfer on a schedule, so you do not retype regular items.'],
      ['Set a schedule', 'Choose weekly, monthly, or every 2–120 months. The schedule can run indefinitely, end on a date, or stop after a chosen number of future entries. The household server creates due transactions once, even when several phones are paired.'],
      ['Edit or pause', 'Tap an editable scheduled entry to load its parameters and automatically return to the edit form. Save changes to update future runs. Pause or delete stops future entries without changing transactions already created. Shared schedules are Master-managed; personal schedules belong to their owner.'],
      ['Review and fix', 'Generated items appear in Activity like any other entry and can be corrected or reversed the same way.']]],
    fr: ['Écritures récurrentes', 'Des écritures qui se répètent selon un calendrier que vous définissez.', [
      ['Objet', 'Une écriture récurrente répète une dépense, un revenu ou un virement selon un calendrier, pour éviter de ressaisir les éléments réguliers.'],
      ['Planifier', 'Choisissez chaque semaine, chaque mois ou tous les 2 à 120 mois. Vous pouvez continuer sans limite, arrêter à une date ou après un nombre d’opérations futures. Le serveur crée chaque opération due une seule fois, même avec plusieurs téléphones.'],
      ['Modifier ou suspendre', 'Touchez une opération modifiable pour charger ses paramètres et revenir automatiquement au formulaire. Enregistrez pour modifier les prochaines échéances. Suspendre ou supprimer ne change pas les opérations déjà créées. Le responsable gère les échéanciers partagés ; chacun gère les siens.'],
      ['Vérifier et corriger', 'Les éléments générés apparaissent dans l’activité comme les autres et se corrigent ou s’annulent de la même façon.']]],
    it: ['Voci ricorrenti', 'Voci che si ripetono secondo una pianificazione definita da te.', [
      ['Scopo', 'Una voce ricorrente ripete una spesa, entrata o trasferimento secondo una pianificazione, così non devi reinserire le voci regolari.'],
      ['Pianificare', 'Scegli ogni settimana, ogni mese o ogni 2–120 mesi. Puoi continuare senza limite, terminare in una data o dopo un numero di movimenti futuri. Il server crea ogni movimento dovuto una sola volta, anche con più telefoni abbinati.'],
      ['Modificare o sospendere', 'Tocca una voce modificabile per caricare i parametri e tornare automaticamente al modulo. Salva per aggiornare le prossime esecuzioni. Sospendere o eliminare non cambia i movimenti già creati. Il responsabile gestisce le pianificazioni condivise; ciascuno gestisce le proprie.'],
      ['Controlla e correggi', 'Le voci generate compaiono nell’attività come le altre e si correggono o stornano allo stesso modo.']]] } },
  { id: 'backups', guide: 'backup', t: {
    en: ['Backups and recovery', 'Encrypted copies, the recovery phrase, and restoring safely.', [
      ['Enrollment and phrase', 'Recovery enrollment happens in a terminal on the server PC, not on the phone. Write down the recovery phrase and keep it separate from the PC and its backup drive; it cannot be recovered if lost.'],
      ['Off-PC storage', 'Automatic encrypted copies need an off-PC USB drive or NAS mount. Home Ledger does not fall back to the PC disk if the mount disappears.'],
      ['Manual backups', 'The phone share sheet or file picker is not proof that a backup was saved. Confirm the .hlbackup file actually exists where you expect it.'],
      ['Restore', 'Restore works only into a fresh, empty database and refuses an existing one. Never restore over the live household. Restore revokes every device session and pending household invitation; reconnect the Master with the targeted recovery invitation, then have the Master invite existing members again. See the recovery guide for safe steps.']]],
    fr: ['Sauvegardes et récupération', 'Copies chiffrées, phrase de récupération et restauration sûre.', [
      ['Inscription et phrase', 'L’inscription à la récupération se fait dans un terminal du PC serveur, pas sur le téléphone. Notez la phrase et gardez-la séparée du PC et de son disque de sauvegarde ; elle est irrécupérable si perdue.'],
      ['Stockage hors PC', 'Les copies chiffrées automatiques nécessitent une clé USB ou un NAS monté hors du PC. Home Ledger ne se rabat pas sur le disque du PC si le montage disparaît.'],
      ['Copies manuelles', 'Le menu de partage ou le sélecteur de fichiers du téléphone ne prouve pas qu’une sauvegarde a été enregistrée. Vérifiez que le fichier .hlbackup existe bien.'],
      ['Restauration', 'La restauration ne fonctionne que vers une base neuve et vide et refuse une base existante. Ne restaurez jamais sur le foyer actif. Elle révoque toutes les sessions d’appareil et les invitations en attente ; reconnectez le Master avec l’invitation de récupération ciblée, puis demandez-lui d’inviter à nouveau les membres. Consultez le guide pour les étapes sûres.']]],
    it: ['Backup e recupero', 'Copie crittografate, frase di recupero e ripristino sicuro.', [
      ['Registrazione e frase', 'La registrazione del recupero si fa in un terminale sul PC server, non sul telefono. Annota la frase e tienila separata dal PC e dall’unità di backup; se la perdi non è recuperabile.'],
      ['Archiviazione fuori dal PC', 'I backup crittografati automatici richiedono un’unità USB o NAS montata fuori dal PC. Home Ledger non ripiega sul disco del PC se il montaggio scompare.'],
      ['Backup manuali', 'Il menu di condivisione o il selettore file del telefono non prova che il backup sia stato salvato. Verifica che il file .hlbackup esista davvero.'],
      ['Ripristino', 'Il ripristino funziona solo in un database nuovo e vuoto e rifiuta uno esistente. Non ripristinare mai sui dati attivi. Revoca tutte le sessioni dei dispositivi e gli inviti in attesa; riconnetti il Master con l’invito di recupero mirato, poi chiedigli di invitare di nuovo i membri. Consulta la guida per i passaggi sicuri.']]] } },
  { id: 'household', t: {
    en: ['Household roles and privacy', 'What the Master and members can see and do.', [
      ['Roles and invitations', 'The Master manages the household, creates shared goals, assigns member quotas, and invites members or existing accounts from Household. Each single-use invitation expires after 10 minutes; the Master can review status and revoke a pending invitation. The server, not a name entered by the invitee, determines the invited identity and role.'],
      ['Privacy', 'Personal goals and personal views belong to their owner. The Master can set a shared quota but cannot see or choose a member’s personal goal.']]],
    fr: ['Rôles du foyer et confidentialité', 'Ce que le responsable et les membres voient et font.', [
      ['Rôles et invitations', 'Le Master gère le foyer, crée les objectifs partagés, attribue les quotas et invite des membres ou des comptes existants depuis Foyer. Chaque invitation à usage unique expire au bout de 10 minutes ; le Master peut consulter son état et révoquer une invitation en attente. C’est le serveur, et non un nom saisi par la personne invitée, qui détermine l’identité et le rôle.'],
      ['Confidentialité', 'Les objectifs et vues personnels appartiennent à leur propriétaire. Le responsable peut fixer un quota partagé mais ne voit ni ne choisit l’objectif personnel d’un membre.']]],
    it: ['Ruoli della casa e privacy', 'Cosa possono vedere e fare responsabile e membri.', [
      ['Ruoli e inviti', 'Il Master gestisce la casa, crea obiettivi condivisi, assegna quote e invita membri o account esistenti da Casa. Ogni invito monouso scade dopo 10 minuti; il Master può controllarne lo stato e revocare un invito in attesa. È il server, non un nome inserito dalla persona invitata, a determinare identità e ruolo.'],
      ['Privacy', 'Obiettivi e viste personali appartengono al proprietario. Il responsabile può fissare una quota condivisa ma non vede né sceglie l’obiettivo personale di un membro.']]] } },
  { id: 'offline', t: {
    en: ['Offline and sync', 'What works without a connection to your PC.', [
      ['Without a connection', 'This help works without internet or a session. When the phone cannot reach your server, the app shows that it is offline and server actions, including creating or accepting household invitations, are unavailable.'],
      ['Pending changes', 'Changes made on the phone are kept as pending until they can sync. Signing out or renewing household access preserves unsynced entries in “Pending changes need review” in Settings and on the pairing page. They are not automatically posted under the new access. Acknowledging the review does not delete or post entries: open Settings → Saved changes → Show saved changes to consult them again. After a restore or access change, check Activity and re-enter only what is missing.']]],
    fr: ['Hors ligne et synchronisation', 'Ce qui fonctionne sans connexion à votre PC.', [
      ['Sans connexion', 'Cette aide fonctionne sans internet ni session. Quand le téléphone ne joint pas le serveur, l’application indique qu’elle est hors ligne et les actions serveur, notamment créer ou accepter des invitations au foyer, sont indisponibles.'],
      ['Modifications en attente', 'Les modifications faites sur le téléphone restent en attente jusqu’à la synchronisation. Une déconnexion ou un renouvellement d’accès conserve les opérations non synchronisées dans la liste des modifications à vérifier, dans Réglages et sur la page d’association. Elles ne sont pas envoyées automatiquement avec le nouvel accès. La confirmation ne supprime ni ne valide les opérations : retrouvez-les dans Réglages → Modifications conservées → Afficher les modifications conservées. Après une restauration ou un changement d’accès, consultez Activité et ressaisissez seulement ce qui manque.']]],
    it: ['Offline e sincronizzazione', 'Cosa funziona senza connessione al PC.', [
      ['Senza connessione', 'Questa guida funziona senza internet né sessione. Quando il telefono non raggiunge il server, l’app indica che è offline e le azioni server, come creare o accettare inviti alla casa, non sono disponibili.'],
      ['Modifiche in sospeso', 'Le modifiche fatte sul telefono restano in sospeso finché non si sincronizzano. La disconnessione o il rinnovo dell’accesso conserva le voci non sincronizzate nell’elenco delle modifiche da verificare, in Impostazioni e nella pagina di associazione. Non vengono inviate automaticamente con il nuovo accesso. La conferma non elimina né registra le voci: ritrovale in Impostazioni → Modifiche conservate → Mostra modifiche conservate. Dopo un ripristino o un cambio di accesso, controlla Attività e reinserisci solo ciò che manca.']]] } },
  { id: 'app-lock', t: {
    en: ['App lock and recovery', 'Optional biometrics, a four-digit PIN, and recovery without discarding pending changes.', [
      ['Enable the lock', 'On Android and iOS, open Settings → App security and turn on Lock app on open. Set a four-digit PIN. The app offers enrolled device biometrics first and uses the PIN when biometrics are unavailable or cancelled. It locks at startup and when returning after more than 30 seconds in the background. Repeated wrong PINs trigger increasing delays, up to 24 hours.'],
      ['If you cannot unlock', 'If both biometrics and the PIN are unavailable, choose recovery. Home Ledger first syncs pending changes. After a successful sync, use a fresh household invitation and set a new PIN. If the server is offline or a change is rejected, recovery stays locked; rejected entries are preserved rather than discarded.'],
      ['What the lock protects', 'The PIN and lock setting stay in device SecureStore and are not included in financial backups. The lock gates the app screen only: it does not encrypt cached ledger files or the server database, and it does not authenticate server requests. The app lock is available in the native Android and iOS apps, not in the web preview.']]],
    fr: ['Verrouillage de l’application et récupération', 'Biométrie facultative, code PIN à quatre chiffres et récupération sans supprimer les modifications en attente.', [
      ['Activer le verrouillage', 'Sur Android et iOS, ouvrez Paramètres → Sécurité de l’application et activez Verrouiller à l’ouverture. Définissez un code PIN à quatre chiffres. L’application propose d’abord les données biométriques configurées ; le PIN sert si elles sont indisponibles ou annulées. Le verrouillage s’active au démarrage et au retour après plus de 30 secondes en arrière-plan. Les erreurs répétées entraînent des délais croissants, jusqu’à 24 heures.'],
      ['Si vous ne pouvez pas déverrouiller', 'Si la biométrie et le PIN sont indisponibles, choisissez la récupération. Home Ledger synchronise d’abord les modifications en attente. Après une synchronisation réussie, utilisez une nouvelle invitation au foyer et définissez un nouveau PIN. Si le serveur est hors ligne ou rejette une modification, la récupération reste bloquée ; les écritures rejetées sont conservées.'],
      ['Protection assurée', 'Le PIN et le réglage restent dans SecureStore sur l’appareil et ne figurent pas dans les sauvegardes financières. Le verrou protège uniquement l’écran de l’application : il ne chiffre ni les fichiers comptables locaux ni la base serveur, et n’authentifie pas les requêtes au serveur. Le verrouillage est disponible dans les applications natives Android et iOS, pas dans l’aperçu web.']]],
    it: ['Blocco dell’app e recupero', 'Biometria facoltativa, PIN a quattro cifre e recupero senza eliminare le modifiche in sospeso.', [
      ['Attivare il blocco', 'Su Android e iOS, apri Impostazioni → Sicurezza app e attiva Blocca all’apertura. Imposta un PIN a quattro cifre. L’app propone prima la biometria registrata; il PIN viene usato se la biometria non è disponibile o viene annullata. L’app si blocca all’avvio e quando torni dopo più di 30 secondi in background. Gli errori ripetuti causano ritardi crescenti, fino a 24 ore.'],
      ['Se non riesci a sbloccare', 'Se biometria e PIN non sono disponibili, scegli il recupero. Home Ledger sincronizza prima le modifiche in sospeso. Dopo una sincronizzazione riuscita, usa un nuovo invito alla casa e imposta un nuovo PIN. Se il server è offline o rifiuta una modifica, il recupero resta bloccato; le voci rifiutate vengono conservate, non eliminate.'],
      ['Cosa protegge il blocco', 'Il PIN e l’impostazione restano nel SecureStore del dispositivo e non sono inclusi nei backup finanziari. Il blocco protegge solo la schermata dell’app: non cifra i file del registro locale o il database del server e non autentica le richieste al server. Il blocco è disponibile nelle app native Android e iOS, non nell’anteprima web.']]] } },
  { id: 'accounts', t: {
    en: ['Accounts and categories', 'Main, Savings, and household accounts, plus spending categories.', [
      ['Accounts', 'Your Main account funds everyday spending. Savings accounts hold saved money, and the household account backs shared goals. One Savings account can serve several personal goals; the Accounts screen separates allocated and unallocated money.'],
      ['Categories', 'Expense categories group spending and underpin monthly budgets. Shared categories are managed by the Master; personal categories belong to their owner.']]],
    fr: ['Comptes et catégories', 'Comptes Principal, Épargne et du foyer, plus catégories de dépenses.', [
      ['Comptes', 'Votre compte Principal finance les dépenses courantes. Les comptes d’épargne contiennent l’argent mis de côté et le compte du foyer soutient les objectifs partagés. Un même compte d’épargne peut servir plusieurs objectifs personnels ; l’écran Comptes sépare l’argent alloué et non alloué.'],
      ['Catégories', 'Les catégories regroupent les dépenses et servent de base aux budgets mensuels. Le responsable gère les catégories partagées ; chacun gère les siennes.']]],
    it: ['Conti e categorie', 'Conti Principale, Risparmio e della casa, più categorie di spesa.', [
      ['Conti', 'Il conto Principale finanzia le spese quotidiane. I conti Risparmio contengono il denaro accantonato e il conto della casa sostiene gli obiettivi condivisi. Uno stesso conto Risparmio può servire più obiettivi personali; la schermata Conti separa denaro assegnato e non assegnato.'],
      ['Categorie', 'Le categorie raggruppano le spese e sono la base dei budget mensili. Il responsabile gestisce quelle condivise; ciascuno gestisce le proprie.']]] } },
];

const ui = {
  en: { helpTitle: 'Help', searchPlaceholder: 'Search help', offlineNotice: 'Available offline. This help is stored in the app and needs no internet or sign-in.', allTopics: 'All topics', noResults: 'No help topics match your search.', noResultsHint: 'Try a shorter word, or clear the search to see every topic.', clearSearch: 'Clear search', topicsLabel: 'Topics', goalsHint: 'Linked contributions move money from Main to Savings. Unlinked goals record progress only. Shared goals use member quotas.', backupHint: 'Keep verified backups off the server PC and the recovery phrase separate. Opening a share sheet does not confirm a saved backup.', budgetsHint: 'Budgets track spending without reserving money. Limits carry forward; past months keep their history.', recurringHint: 'The server creates each due entry once. Tap a scheduled entry to edit it; pausing stops future entries without changing past activity.', readMore: 'Read more in Help', guideNote: 'Opens a read-only local guide.' },
  fr: { helpTitle: 'Aide', searchPlaceholder: 'Rechercher dans l’aide', offlineNotice: 'Disponible hors ligne. Cette aide est intégrée à l’application et ne demande ni internet ni connexion.', allTopics: 'Tous les sujets', noResults: 'Aucun sujet d’aide ne correspond à votre recherche.', noResultsHint: 'Essayez un mot plus court ou effacez la recherche pour voir tous les sujets.', clearSearch: 'Effacer la recherche', topicsLabel: 'Sujets', goalsHint: 'Les contributions liées transfèrent du compte Principal vers Épargne. Les objectifs non liés suivent seulement la progression. Les objectifs partagés utilisent des quotas.', backupHint: 'Gardez les sauvegardes vérifiées hors du PC serveur et la phrase séparée. Ouvrir le menu de partage ne confirme pas l’enregistrement.', budgetsHint: 'Les budgets suivent les dépenses sans réserver d’argent. Les limites se reportent ; les mois passés gardent leur historique.', recurringHint: 'Le serveur crée chaque opération due une fois. Touchez une opération pour la modifier ; la suspension arrête les suivantes sans changer le passé.', readMore: 'En savoir plus dans l’aide', guideNote: 'Ouvre un guide local en lecture seule.' },
  it: { helpTitle: 'Aiuto', searchPlaceholder: 'Cerca nell’aiuto', offlineNotice: 'Disponibile offline. Questa guida è inclusa nell’app e non richiede internet né accesso.', allTopics: 'Tutti gli argomenti', noResults: 'Nessun argomento corrisponde alla ricerca.', noResultsHint: 'Prova una parola più breve o cancella la ricerca per vedere tutti gli argomenti.', clearSearch: 'Cancella ricerca', topicsLabel: 'Argomenti', goalsHint: 'I contributi collegati spostano denaro da Principale a Risparmio. Gli obiettivi non collegati registrano solo l’avanzamento. Quelli condivisi usano quote dei membri.', backupHint: 'Conserva backup verificati fuori dal PC server e la frase separata. Aprire il menu di condivisione non conferma il salvataggio.', budgetsHint: 'I budget seguono le spese senza riservare denaro. I limiti passano ai mesi successivi; i mesi precedenti mantengono lo storico.', recurringHint: 'Il server crea ogni movimento dovuto una sola volta. Tocca una voce per modificarla; sospendere ferma le successive senza cambiare il passato.', readMore: 'Leggi di più nell’aiuto', guideNote: 'Apre una guida locale in sola lettura.' },
} as const;

const guideLabels: Record<Locale, { goal: string; backup: string }> = {
  en: { goal: 'Open the shared goal walkthrough', backup: 'Open the backup and recovery guide' },
  fr: { goal: 'Ouvrir le pas à pas des objectifs partagés', backup: 'Ouvrir le guide de sauvegarde et récupération' },
  it: { goal: 'Apri la guida passo passo degli obiettivi condivisi', backup: 'Apri la guida a backup e recupero' },
};

export type HelpUi = { [K in keyof (typeof ui)['en']]: string };

export function getHelpUi(locale: Locale): HelpUi {
  return ui[locale] ?? ui.en;
}

export function getHelpTopics(locale: Locale): HelpTopic[] {
  const l: Locale = locale in ui ? locale : 'en';
  return raw.map((r) => {
    const [title, summary, sections] = r.t[l];
    return {
      id: r.id,
      title,
      summary,
      sections: sections.map(([t, body]) => ({ title: t, body })),
      ...(r.guide ? {
        guideRoute: r.guide === 'goal' ? '/shared-goal-guide' as const : '/backup-recovery-guide' as const,
        guideLabel: guideLabels[l][r.guide],
      } : {}),
    };
  });
}

export function normalizeHelpText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ').toLowerCase();
}

export function filterHelpTopics(topics: HelpTopic[], query: string): HelpTopic[] {
  const terms = normalizeHelpText(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return topics;
  return topics.filter((t) => {
    const hay = normalizeHelpText([t.title, t.summary, ...t.sections.flatMap((s) => [s.title, s.body])].join(' '));
    return terms.every((term) => hay.includes(term));
  });
}
