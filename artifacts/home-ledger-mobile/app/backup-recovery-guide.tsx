import { Feather } from '@expo/vector-icons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/Ui';
import { useColors } from '@/hooks/useColors';
import { useI18n, type Locale } from '@/lib/i18n';

type Step = { title: string; detail: string; command?: string };
type Guide = { title: string; intro: string; steps: Step[]; warning: string; warningTitle: string };

const enroll = 'pnpm --filter @workspace/api-server run backup:enroll';
const schedule = 'BUDGET_RECOVERY_DIR=/mnt/home-ledger-backups pnpm run server:linux';
const restore = 'pnpm --filter @workspace/api-server run backup:restore';
const inviteMaster = 'pnpm --filter @workspace/api-server invite-master';

const guides: Record<Locale, Guide> = {
  en: {
    title: 'Keep your household recoverable',
    intro: 'The Master saves encrypted backups. Enrollment and recovery happen in a terminal on the Linux server PC, not on a phone.',
    steps: [
      {
        title: 'Enroll and write down the phrase',
        detail: 'After creating the household, run this once from the project folder as the same Linux user who starts the server. Keep the phrase away from both the PC and its backup drive. It cannot be recovered if lost.',
        command: enroll,
      },
      {
        title: 'Mount a USB drive or NAS',
        detail: 'Use the actual, writable mount point of an off-PC drive or NAS, not an ordinary local folder or a subfolder. Replace the example path below and provide it every time the server starts. Once enrolled, Home Ledger saves an encrypted copy at startup and every 24 hours, retaining copies for 30 days. It never falls back to the PC disk if the mount disappears.',
        command: schedule,
      },
      {
        title: 'Save a manual backup',
        detail: 'In Settings → Data, tap Save encrypted backup. On Android, choose a local folder in the file picker; on iPhone, choose Save to Files in the share sheet. A USB drive connected to the server PC is not visible from the phone: transfer the .hlbackup file to it afterward and verify that it exists. Check Home or Settings for the last successful automatic copy.',
      },
      {
        title: 'Restore on a replacement PC',
        detail: 'Install the updated server files but do not start the API yet. Run the restore command from the project folder, enter your newest .hlbackup path and recovery phrase, review the household preview, then confirm. Restore refuses an existing database. It revokes every device session and pending household invitation. Start the server afterward as the same Linux user with the same database-path settings.',
        command: restore,
      },
      {
        title: 'Reconnect the Master and invite members',
        detail: 'Reconfigure the off-PC mount. When the restored household has no active Master device, startup prints a one-use, 10-minute invitation targeted to its current Master; enter that code with the server address. If needed, on the trusted server PC create one with the command below (from artifacts/api-server, run pnpm invite-master). This local command preserves existing devices and has no HTTP recovery endpoint; do not run it on an untrusted PC or share the code publicly. Once the Master is connected, create new invitations for existing members from Household. Pending phone changes are not replayed automatically; compare them with the restored ledger and re-enter only what is missing. A daily copy may be up to about 24 hours behind.',
        command: inviteMaster,
      },
    ],
    warningTitle: 'Never restore over the live household',
    warning: 'Practice only with a new, empty database path. The encrypted backups do not encrypt the live SQLite database on the PC; enable full-disk encryption for that disk.',
  },
  fr: {
    title: 'Gardez votre foyer récupérable',
    intro: 'Le responsable enregistre les sauvegardes chiffrées. L’inscription et la restauration se font dans le terminal du PC serveur Linux, pas sur un téléphone.',
    steps: [
      {
        title: 'S’inscrire et noter la phrase',
        detail: 'Après la création du foyer, exécutez cette commande une fois depuis le dossier du projet avec le même utilisateur Linux que le serveur. Gardez la phrase loin du PC et du disque de sauvegarde. Elle ne peut pas être récupérée si elle est perdue.',
        command: enroll,
      },
      {
        title: 'Monter une clé USB ou un NAS',
        detail: 'Utilisez le point de montage réel et accessible en écriture du périphérique externe, pas un dossier local ni un sous-dossier. Remplacez le chemin d’exemple et indiquez-le à chaque démarrage. Après inscription, une copie chiffrée est créée au démarrage et toutes les 24 heures, avec 30 jours de conservation. Aucun repli sur le disque du PC.',
        command: schedule,
      },
      {
        title: 'Enregistrer une copie manuelle',
        detail: 'Dans Paramètres → Données, touchez Enregistrer la sauvegarde chiffrée. Sur Android, choisissez un dossier local ; sur iPhone, utilisez Enregistrer dans Fichiers depuis le menu de partage. Une clé USB branchée au PC serveur n’est pas visible depuis le téléphone : transférez-y ensuite le fichier .hlbackup et vérifiez sa présence. Vérifiez la dernière copie automatique dans Accueil ou Paramètres.',
      },
      {
        title: 'Restaurer sur un nouveau PC',
        detail: 'Installez les fichiers du serveur à jour sans démarrer l’API. Exécutez la commande depuis le dossier du projet, saisissez le chemin du fichier .hlbackup le plus récent et la phrase, vérifiez l’aperçu du foyer, puis confirmez. La restauration refuse une base existante et révoque toutes les sessions d’appareil ainsi que les invitations au foyer en attente. Démarrez ensuite le serveur avec le même utilisateur Linux et le même chemin de base de données.',
        command: restore,
      },
      {
        title: 'Reconnecter le Master et inviter les membres',
        detail: 'Reconfigurez le support externe. Quand le foyer restauré n’a aucun appareil Master actif, le démarrage affiche une invitation à usage unique de 10 minutes destinée à son Master actuel ; saisissez ce code avec l’adresse du serveur. Si nécessaire, créez-en une depuis le PC serveur de confiance avec la commande ci-dessous (depuis artifacts/api-server, lancez pnpm invite-master). Cette commande locale préserve les appareils existants et aucune récupération HTTP n’est disponible ; ne l’exécutez pas sur un PC non fiable et ne diffusez pas le code. Une fois le Master reconnecté, créez de nouvelles invitations pour les membres existants dans Foyer. Les modifications en attente ne sont pas rejouées automatiquement : comparez-les au registre restauré et ressaisissez seulement celles qui manquent. Une copie quotidienne peut dater d’environ 24 heures.',
        command: inviteMaster,
      },
    ],
    warningTitle: 'Ne restaurez jamais sur le foyer actif',
    warning: 'Faites les essais uniquement avec une nouvelle base vide. Les sauvegardes chiffrées ne chiffrent pas la base SQLite active sur le PC ; activez le chiffrement complet du disque.',
  },
  it: {
    title: 'Mantieni recuperabili i dati di casa',
    intro: 'Il responsabile salva i backup crittografati. La registrazione e il ripristino si eseguono nel terminale del PC server Linux, non sul telefono.',
    steps: [
      {
        title: 'Registra e annota la frase',
        detail: 'Dopo aver creato la casa, esegui questo comando una volta dalla cartella del progetto con lo stesso utente Linux che avvia il server. Conserva la frase lontano dal PC e dall’unità di backup. Se la perdi non può essere recuperata.',
        command: enroll,
      },
      {
        title: 'Monta una USB o un NAS',
        detail: 'Usa il vero punto di montaggio scrivibile di un’unità esterna, non una cartella locale o una sottocartella. Sostituisci il percorso di esempio e forniscilo a ogni avvio. Dopo la registrazione, Home Ledger crea un backup crittografato all’avvio e ogni 24 ore, conservandolo per 30 giorni. Se il montaggio scompare, non ripiega sul disco del PC.',
        command: schedule,
      },
      {
        title: 'Salva una copia manuale',
        detail: 'In Impostazioni → Dati, tocca Salva backup crittografato. Su Android scegli una cartella locale; su iPhone scegli Salva su File dal menu di condivisione. Un’unità USB collegata al PC server non è visibile dal telefono: trasferisci poi il file .hlbackup sull’unità e verifica che ci sia. Controlla l’ultimo backup automatico in Home o Impostazioni.',
      },
      {
        title: 'Ripristina su un nuovo PC',
        detail: 'Installa i file aggiornati del server senza avviare l’API. Esegui il comando dalla cartella del progetto, inserisci il percorso del file .hlbackup più recente e la frase, controlla l’anteprima dei dati di casa, poi conferma. Il ripristino rifiuta un database esistente e revoca tutte le sessioni dei dispositivi e gli inviti alla casa in attesa. Avvia quindi il server con lo stesso utente Linux e lo stesso percorso del database.',
        command: restore,
      },
      {
        title: 'Riconnetti il Master e invita i membri',
        detail: 'Riconfigura l’unità esterna. Quando la casa ripristinata non ha dispositivi Master attivi, all’avvio viene mostrato un invito monouso di 10 minuti destinato al Master attuale; inserisci quel codice con l’indirizzo del server. Se serve, creane uno dal PC server fidato con il comando qui sotto (da artifacts/api-server, esegui pnpm invite-master). Questo comando locale conserva i dispositivi esistenti e non esiste un recupero HTTP; non eseguirlo su un PC non fidato e non diffondere il codice. Dopo aver riconnesso il Master, crea nuovi inviti per i membri esistenti da Casa. Le modifiche in sospeso non vengono riprodotte automaticamente: confrontale con il registro ripristinato e reinserisci solo quelle mancanti. Una copia giornaliera può avere circa 24 ore di ritardo.',
        command: inviteMaster,
      },
    ],
    warningTitle: 'Non ripristinare mai sui dati attivi',
    warning: 'Fai prove solo con un nuovo database vuoto. I backup crittografati non crittografano il database SQLite attivo sul PC; attiva la cifratura completa del disco.',
  },
};

export default function BackupRecoveryGuide() {
  const c = useColors();
  const { locale } = useI18n();
  const guide = guides[locale];

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.content}>
      <View style={[styles.heroIcon, { backgroundColor: c.secondary }]}>
        <Feather name="shield" size={25} color={c.primary} />
      </View>
      <Text style={[styles.heading, { color: c.foreground }]}>{guide.title}</Text>
      <Text style={[styles.intro, { color: c.mutedForeground }]}>{guide.intro}</Text>

      {guide.steps.map((step, index) => (
        <Card key={step.title}>
          <View style={styles.stepHeader}>
            <Text style={[styles.stepNumber, { color: c.primary }]}>{String(index + 1).padStart(2, '0')}</Text>
            <Text style={[styles.stepTitle, { color: c.foreground }]}>{step.title}</Text>
          </View>
          <Text style={[styles.detail, { color: c.mutedForeground }]}>{step.detail}</Text>
          {step.command ? (
            <Text selectable style={[styles.command, { backgroundColor: c.secondary, color: c.foreground }]}>{step.command}</Text>
          ) : null}
        </Card>
      ))}

      <Card style={{ borderColor: c.destructive }}>
        <Text style={[styles.warningTitle, { color: c.destructive }]}>{guide.warningTitle}</Text>
        <Text style={[styles.detail, { color: c.foreground }]}>{guide.warning}</Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 60, gap: 14 },
  heroIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 27, lineHeight: 34 },
  intro: { fontSize: 14, lineHeight: 21, marginBottom: 4 },
  stepHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 9 },
  stepNumber: { fontFamily: 'Inter_700Bold', fontSize: 19 },
  stepTitle: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 17, lineHeight: 23 },
  detail: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  command: { marginTop: 14, padding: 12, borderRadius: 10, fontFamily: 'monospace', fontSize: 12, lineHeight: 19 },
  warningTitle: { fontFamily: 'Inter_700Bold', fontSize: 16, marginBottom: 8 },
});