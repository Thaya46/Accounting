/** Domain errors carrying an HTTP status. Free of Next.js imports so services stay testable. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "ERROR",
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, message, "BAD_REQUEST", details);
export const forbidden = (message = "Access denied") => new ApiError(403, message, "FORBIDDEN");
export const notFound = (message = "Not found") => new ApiError(404, message, "NOT_FOUND");
export const conflict = (message: string, details?: unknown) => new ApiError(409, message, "CONFLICT", details);
