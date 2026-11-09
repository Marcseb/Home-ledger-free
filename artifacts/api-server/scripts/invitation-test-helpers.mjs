export function bootstrapDemoMaster(store, deviceId, deviceName) {
  const { invitationCode } = store.createLocalMasterInvitation();
  return store.redeemHouseholdInvitation({ invitationCode, deviceId, deviceName });
}

export function inviteHouseholdMember(store, master, masterDeviceId, displayName, deviceId, deviceName) {
  const { invitationCode } = store.createHouseholdInvitation(
    master.state.groupId,
    master.user.id,
    masterDeviceId,
    { displayName },
  );
  return store.redeemHouseholdInvitation({ invitationCode, deviceId, deviceName });
}

export function inviteExistingHouseholdUser(store, master, masterDeviceId, userId, deviceId, deviceName) {
  const { invitationCode } = store.createHouseholdInvitation(
    master.state.groupId,
    master.user.id,
    masterDeviceId,
    { userId },
  );
  return store.redeemHouseholdInvitation({ invitationCode, deviceId, deviceName });
}

export async function createHttpInvitationSession(request, master, invitation, deviceId, deviceName) {
  const created = await request("/household/invitations", invitation, master.deviceToken);
  if (created.status !== 201) throw new Error(`Household invitation creation failed: ${created.status}`);
  const redeemed = await request("/pairing/invitations/redeem", {
    invitationCode: created.body.invitationCode,
    deviceId,
    deviceName,
  });
  if (redeemed.status !== 200) throw new Error(`Household invitation redemption failed: ${redeemed.status}`);
  return redeemed.body;
}