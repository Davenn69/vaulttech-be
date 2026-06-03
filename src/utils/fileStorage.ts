const REVISION_SEGMENT = "/revisions/";

const normalizeStoragePath = (storagePath: string) =>
  storagePath.replaceAll("\\", "/");

export const buildFileRevisionBasePath = (
  profileId: string,
  folderId: string,
  fileId: string,
  uniqueName: string,
) => `${profileId}/${folderId}/${fileId}/${uniqueName}`;

export const buildInitialRevisionStorageKey = (
  basePath: string,
  extension: string,
) => `${basePath}${REVISION_SEGMENT}file${extension ? `.${extension}` : ""}`;

export const buildNextRevisionStorageKey = (
  basePath: string,
  extension: string,
  versionNumber: number,
) =>
  `${basePath}${REVISION_SEGMENT}file-v${versionNumber}${extension ? `.${extension}` : ""}`;

export const resolveFileRevisionBasePath = (storagePath: string) => {
  const normalized = normalizeStoragePath(storagePath);
  const revisionIndex = normalized.indexOf(REVISION_SEGMENT);

  if (revisionIndex >= 0) {
    return normalized.slice(0, revisionIndex);
  }

  const lastSlashIndex = normalized.lastIndexOf("/");
  if (lastSlashIndex < 0) {
    return normalized;
  }

  const folderPath = normalized.slice(0, lastSlashIndex);
  const fileName = normalized.slice(lastSlashIndex + 1);
  const uniqueName = fileName.includes(".")
    ? fileName.slice(0, fileName.lastIndexOf("."))
    : fileName;

  return `${folderPath}/${uniqueName}`;
};
