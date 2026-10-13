import "server-only";
import { cookies } from "next/headers";

// The one place that forwards cookies, CSRF and the request id upstream.
export function proxy(path: (params: Record<string, string>) => string) {
  return async (request: Request, context: { params: Promise<Record<string, string>> }) => {
    const jar = await cookies();
    const url = `${process.env.BACKEND_API_URL}${path(await context.params)}`;
    return fetch(url, { method: request.method, headers: { cookie: jar.toString() } });
  };
}
