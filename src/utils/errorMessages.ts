class ErrorMessages {
    notFound: string = "route not found"
    missingBody: string = "missing body parameter"

    emailMissing: string = "missing email parameter"
    emailCheck: string = "email must be valid"

    passwordMissing: string = "missing password parameter"
    passwordLength: string = "password must have 30 characters or less"
    passwordCheck: string = "password must have 1 uppercase, 1 lowercase, 1 number, 1 special char"

    usernameMissing: string = "missing username parameter"
    usernameLength: string = "username must have 30 characters or less"

    idMissing: string = "missing id parameter"

    tokenMissing: string = "token is not provided"
    invalidUser: string = "invalid user"
    fileMissing: string = "missing file parameter"

    folderIdMissing: string = "missing folder id parameter"
    nameMissing: string = "missing name parameter"
}

export const errors = new ErrorMessages()