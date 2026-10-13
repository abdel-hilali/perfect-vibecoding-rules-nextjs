import { getProject } from "@/lib/apis/projects/server-apis";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  return <h1>{project.name}</h1>;
}
