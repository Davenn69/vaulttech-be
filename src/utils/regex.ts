export const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/

// Strong: Min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char
export const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/

// Must start with a letter
export const usernameRegex = /^[a-zA-Z][a-zA-Z0-9_]{0,29}$/