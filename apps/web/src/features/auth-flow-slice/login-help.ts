type LoginProblem = "suspended" | "unverified" | "rate-limited" | "mismatch";

/**
 * Sorts a login error message into what the person should do next. The web
 * maps the API's error codes to these messages, so the wording is the contract
 * between the two. Anything else gets no extra help.
 */
export function loginProblem(message: string): LoginProblem | undefined {
  if (/account is suspended/i.test(message)) return "suspended";
  if (/verify your email/i.test(message)) return "unverified";
  if (/too many attempts/i.test(message)) return "rate-limited";
  if (/did not match|check your details/i.test(message)) return "mismatch";
  return undefined;
}
