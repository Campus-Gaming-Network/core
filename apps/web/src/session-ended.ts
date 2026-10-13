/** Set on a response in which the server cleared a session the API rejected. */
export const sessionEndedHeader = "x-cgn-session-ended";

/** Dispatched on `window` when a response carries that header. */
export const sessionEndedEvent = "cgn:session-ended";

export const sessionEndedFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.headers.has(sessionEndedHeader)) {
    window.dispatchEvent(new Event(sessionEndedEvent));
  }
  return response;
};
