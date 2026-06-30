import { SkillsListView } from "./_components/SkillsListView/SkillsListView";

/* Route: /skills (Skills list). Thin route entry — the view, its create/import
   modals, side preview drawer, styles, constants and i18n are colocated under
   _components/SkillsListView. */
export default function SkillsPage() {
  return <SkillsListView />;
}
