"use client";

export const CARD_SIZES = { small: 1, large: 2 } as const;

export function ProjectCard({ name }: { name: string }) {
  return <div className="bg-surface text-on-surface">{name}</div>;
}
