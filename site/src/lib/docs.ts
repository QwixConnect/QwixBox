// The repo's markdown has no frontmatter, so titles and blurbs live here rather than being
// scraped out of the first heading.
export const TITLES: Record<string, string> = {
  readme: "Documentation guide",
  status: "Project status",
  issues: "Active project issues",
  changelog: "Change log",
  mvp: "Path to MVP",
  "mvp-plan": "MVP delivery plan",
  roadmap: "Product roadmap",
  "testing-on-real-hardware": "Testing on real hardware",
  acceptance: "Acceptance procedures",
  rollback: "Upgrades and rollback",
  restore: "Restoring from a backup",
  "v1-retrospective": "QwixPBX v1 retrospective",
  "design/backlog": "Design — backlog",
  "design/billing": "Design — billing",
  "design/call-centre": "Design — call centre",
  "design/tenancy-and-resellers": "Design — tenancy and resellers",
  "design/implementation-plan": "Design — implementation phases",
};

export const ORDER = [
  "status",
  "issues",
  "changelog",
  "readme",
  "mvp",
  "mvp-plan",
  "roadmap",
  "testing-on-real-hardware",
  "acceptance",
  "rollback",
  "restore",
  "v1-retrospective",
];

const BLURBS: Record<string, string> = {
  readme: "Where to find status, evidence, issues and retained design work.",
  status: "Current implementation, verification boundaries and next work.",
  issues: "Open findings with source evidence and closure checks.",
  changelog: "Dated changes, moves, deletions and replacements.",
  mvp: "What stands between here and carrying a paying customer's calls.",
  "mvp-plan": "The ordered milestones and decisions that close each MVP gate.",
  roadmap: "All 27 product areas, marked against the code rather than against intent.",
  "testing-on-real-hardware": "The procedure for the two tests that close the open questions.",
  acceptance: "Pass conditions and steps for gates 2, 3, 4, 5 and 7.",
  rollback: "What an upgrade keeps, the data-loss gate, and how to roll one back.",
  restore: "What a backup holds and how restore.sh brings a host back from it.",
  "v1-retrospective": "What the first attempt was, and what was kept.",
};

export function blurb(id: string): string {
  return BLURBS[id] ?? "Design note — describes work that is not built.";
}
