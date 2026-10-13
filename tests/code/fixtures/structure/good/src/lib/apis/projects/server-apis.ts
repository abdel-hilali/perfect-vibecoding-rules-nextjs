import "server-only";
import { fetchServer } from "@/lib/server/fetch-server";

export const listProjects = () => fetchServer("/projects");
export const getProject = (id: string) => fetchServer(`/projects/${id}`);
