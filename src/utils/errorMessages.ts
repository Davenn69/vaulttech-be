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
  nameMissing: string = "missing name parameter";
  colorMissing: string = "missing color parameter";
  categoryIdMissing: string = "missing category id parameter";

  fileNotFound: string = "file not found";
  folderNotFound: string = "folder not found";
  categoryNotFound: string = "category not found";
  categoryHasFiles: string = "category is still used by files";

  folderNotCreated: string = "folder not created";
  categoryNotCreated: string = "category not created";

  uploadFileFailed: string = "unable to upload file";
  downloadFileFailed: string = "unable to download file";
  unableToLoadFile: string = "unable to load photo";
}

export const errors = new ErrorMessages();
