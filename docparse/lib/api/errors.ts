export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** Server request id, worth quoting to support. */
    public requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong. Please try again.";
}
