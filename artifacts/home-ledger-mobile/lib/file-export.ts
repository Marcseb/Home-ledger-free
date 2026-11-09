import { type File } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';

export async function saveFileToAndroidFolder(
  source: File,
  filename: string,
  mimeType: string,
  verificationError: string,
): Promise<boolean> {
  const permission = await LegacyFileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return false;

  const destination = await LegacyFileSystem.StorageAccessFramework.createFileAsync(
    permission.directoryUri,
    filename,
    mimeType,
  );
  try {
    await LegacyFileSystem.StorageAccessFramework.writeAsStringAsync(
      destination,
      await source.base64(),
      { encoding: LegacyFileSystem.EncodingType.Base64 },
    );
    const [sourceInfo, savedInfo] = await Promise.all([
      LegacyFileSystem.getInfoAsync(source.uri, { md5: true }),
      LegacyFileSystem.getInfoAsync(destination, { md5: true }),
    ]);
    if (!sourceInfo.exists || !savedInfo.exists || !sourceInfo.md5 || sourceInfo.md5 !== savedInfo.md5) {
      throw new Error(verificationError);
    }
    return true;
  } catch (error) {
    await LegacyFileSystem.StorageAccessFramework.deleteAsync(destination, { idempotent: true }).catch(() => {});
    throw error;
  }
}
