import { errors } from "./errorMessages";
import { emailRegex, passwordRegex } from "./regex";

interface ValidationTypes {
    validateEmail: (email: string | undefined) => string | null,
    validatePassword: (password: string | undefined) => string | null,
    validateUsername: (username: string | undefined) => string | null,
}

class Validation implements ValidationTypes {
    validatePassword = (password: string | undefined) => {
        if (!password) return errors.passwordMissing

        if (password.length > 30) return errors.passwordLength

        if (!passwordRegex.test(password)) return errors.passwordCheck
        return null;
    }
    validateEmail = (email: string | undefined) => {
        if (!email) return errors.emailMissing

        if (!emailRegex.test(email)) return errors.emailCheck

        return null
    }
    validateUsername = (username: string | undefined) => {
        if (!username) return errors.usernameMissing

        if (username.length > 30) return errors.usernameLength

        return null
    }
}

export const validation = new Validation()