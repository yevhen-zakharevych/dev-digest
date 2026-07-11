"use client";

import { useParams } from "next/navigation";
import { ProjectContextView } from "./_components/ProjectContextView/ProjectContextView";

/* Route: /repos/:repoId/context (Project Context). Thin route entry — all
   feature logic lives in _components/ProjectContextView. */
export default function ProjectContextPage() {
  const params = useParams<{ repoId: string }>();
  return <ProjectContextView repoId={params.repoId} />;
}
