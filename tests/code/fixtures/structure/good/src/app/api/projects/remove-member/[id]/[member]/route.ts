import { proxy } from "@/lib/server/proxy-to-backend";

export const DELETE = proxy(({ id, member }) => `/projects/${id}/members/${member}`);
