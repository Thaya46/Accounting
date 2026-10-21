"use client";

export class ClientApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** JSON fetch helper for client components. Throws ClientApiError with the server's message. */
export async function apiFetch<T = unknown>(url: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
    credentials: "same-origin",
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (data as { error?: { message?: string; code?: string; details?: unknown } } | null)?.error;
    if (res.status === 401 && typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new ClientApiError(err?.message ?? `Request failed (${res.status})`, res.status, err?.code, err?.details);
  }
  return data as T;
}
