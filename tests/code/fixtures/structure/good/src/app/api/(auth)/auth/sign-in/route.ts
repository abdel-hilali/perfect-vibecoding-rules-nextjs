import { proxy } from "@/lib/server/proxy-to-backend";

// The public name says what the call does; the upstream path stays server-side.
export const POST = proxy(() => "/auth/login");
