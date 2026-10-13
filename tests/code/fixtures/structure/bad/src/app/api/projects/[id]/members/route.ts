import { proxy } from "@/lib/server/proxy-to-backend";

export const GET = proxy(({ id }) => `/projects/${id}/members`);
