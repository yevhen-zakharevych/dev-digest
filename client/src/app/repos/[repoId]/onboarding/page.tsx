"use client";

import { useParams } from "next/navigation";
import { OnboardingView } from "./_components/OnboardingView/OnboardingView";

/* Route: /repos/:repoId/onboarding (Onboarding Tour, AC-19) — distinct from
   the existing unrelated /onboarding "Add a repository" screen. Thin route
   entry — all feature logic lives in _components/OnboardingView. */
export default function OnboardingPage() {
  const params = useParams<{ repoId: string }>();
  return <OnboardingView repoId={params.repoId} />;
}
