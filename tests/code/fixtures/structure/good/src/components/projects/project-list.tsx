// A client module may import a client constant: it gets the real value.
"use client";

import { CARD_SIZES, ProjectCard } from "./project-card";

export function ProjectList({ projects }: { projects: { name: string }[]; links: unknown }) {
  return projects.map((p) => <ProjectCard key={p.name} name={`${p.name} ${CARD_SIZES.small}`} />);
}
