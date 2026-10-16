/**
 * Attributes for an email input: the on-screen keyboard offers "@", and the
 * browser neither capitalizes nor spell-checks an address.
 */
export const emailInputProps = {
  type: "email",
  autoComplete: "email",
  autoCapitalize: "none",
  spellCheck: false,
  inputMode: "email",
  maxLength: 320,
} as const;

/** The password length the API enforces; the form says it up front. */
export const passwordRules = { minLength: 8, maxLength: 256 } as const;

export const passwordHint =
  "Use at least 8 characters. A few random words make a strong password that is easy to remember.";
