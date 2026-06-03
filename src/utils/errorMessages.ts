class ErrorMessages {
  negativePageNumbers: string = "page number must be a positive value";

  notFound: string = "route not found";
  missingBody: string = "missing body parameter";

  emailMissing: string = "missing email parameter";
  emailCheck: string = "email must be valid";

  passwordMissing: string = "missing password parameter";
  passwordLength: string = "password must have 30 characters or less";
  passwordCheck: string =
    "password must have 1 uppercase, 1 lowercase, 1 number, 1 special char";

  usernameMissing: string = "missing username parameter";
  usernameLength: string = "username must have 30 characters or less";

  idMissing: string = "missing id parameter";

  tokenMissing: string = "token is not provided";
  invalidUser: string = "invalid user";
  fileMissing: string = "missing file parameter";
  fileIdMissing: string = "missing file id parameter";

  folderIdMissing: string = "missing folder id parameter";
  supervisorIdMissing: string = "missing supervisor id parameter";
  nameMissing: string = "missing name parameter";
  colorMissing: string = "missing color parameter";
  categoryIdMissing: string = "missing category id parameter";
  permissionTypeMissing: string = "missing permission type parameter";
  grantedToMissing: string = "missing granted to parameter";
  permissionResourceMissing: string = "missing permission resource parameter";

  fileNotFound: string = "file not found";
  fileNotAccessible: string = "file not accessible";
  folderNotFound: string = "folder not found";
  fileDeleteFailed: string = "unable to delete file";
  folderDeleteFailed: string = "unable to delete folder";
  categoryNotFound: string = "category not found";
  permissionNotFound: string = "permission not found";
  permissionAlreadyExists: string = "permission already exists";
  permissionNotCreated: string = "permission not created";
  permissionNotAllowed: string = "you are not allowed to grant this permission";
  reviewNotFound: string = "review not found";
  revisionNotFound: string = "revision not found";
  invitationAlreadyExists: string = "invitation already exists";
  invitationNotFound: string = "invitation not found";
  invitationAlreadyProcessed: string = "invitation already processed";
  invitationNotAllowed: string =
    "you are not allowed to accept this invitation";
  invitationNotAllowedToDecline: string =
    "you are not allowed to decline this invitation";
  reviewNotAllowed: string = "you are not allowed to review this document";
  reviewAlreadyProcessed: string = "review already processed";
  reviewNotUpdated: string = "review not updated";
  categoryHasFiles: string = "category is still used by files";

  folderNotCreated: string = "folder not created";
  categoryNotCreated: string = "category not created";
  invitationNotCreated: string = "invitation not created";
  invitationNotUpdated: string = "invitation not updated";

  uploadFileFailed: string = "unable to upload file";
  downloadFileFailed: string = "unable to download file";
  unableToLoadFile: string = "unable to load file";
  unableToLoadPhoto: string = "unable to load photo";
}

export const errors = new ErrorMessages();
