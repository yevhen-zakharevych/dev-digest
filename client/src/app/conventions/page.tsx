import { ConventionsListView } from "./_components/ConventionsListView/ConventionsListView";

/* Route: /conventions (Skills Lab → Conventions). Thin route entry — the view,
   its card grid, edit interactions and the "create skill from conventions"
   modal are colocated under _components/. */
export default function ConventionsPage() {
  return <ConventionsListView />;
}
