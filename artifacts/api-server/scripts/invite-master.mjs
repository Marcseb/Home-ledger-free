import { createLocalMasterInvitation } from "../src/lib/budget-store.ts";

try {
  const result = createLocalMasterInvitation();
  process.stdout.write("A one-use, 10-minute invitation was created for the current Master.\n");
  process.stdout.write(`Master recovery code: ${result.invitationCode}\n`);
  process.stdout.write(`Expires: ${result.invitation.expiresAt}\n`);
  process.stdout.write("Enter this code in the upgraded Home Ledger client. Existing devices were not revoked.\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Could not create Master invitation"}\n`);
  process.exitCode = 1;
}