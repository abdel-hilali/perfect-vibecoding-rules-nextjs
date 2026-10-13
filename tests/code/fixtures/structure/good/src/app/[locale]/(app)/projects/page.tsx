import { listProjects } from "@/lib/apis/projects/server-apis";
import { NAV_LINKS } from "@/lib/constants/nav-links";
import { ProjectList } from "@/components/projects/project-list";

export default async function ProjectsPage() {
  const projects = await listProjects();
  return <ProjectList projects={projects} links={NAV_LINKS} />;
}
