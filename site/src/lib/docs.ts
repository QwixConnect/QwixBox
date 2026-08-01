// The repo's markdown has no frontmatter, so titles and blurbs live here rather than being
// scraped out of the first heading.
export const TITLES: Record<string, string> = {
  mvp: "Path to MVP",
  roadmap: "Product roadmap",
  "testing-on-real-hardware": "Testing on real hardware",
  "portal-ui-plan": "Portal UI — shipped",
  "v1-retrospective": "QwixPBX v1 retrospective",
  "design/backlog": "Design — backlog",
  "design/billing": "Design — billing",
  "design/call-centre": "Design — call centre",
  "design/tenancy-and-resellers": "Design — tenancy and resellers",
};

export const ORDER = [
  "mvp",
  "roadmap",
  "testing-on-real-hardware",
  "portal-ui-plan",
  "v1-retrospective",
];

const BLURBS: Record<string, string> = {
  mvp: "What stands between here and carrying a paying customer's calls.",
  roadmap: "All 27 product areas, marked against the code rather than against intent.",
  "testing-on-real-hardware": "The procedure for the two tests that close the open questions.",
  "portal-ui-plan": "What shipped in the portal, and the decisions behind it.",
  "v1-retrospective": "What the first attempt was, and what was kept.",
};

export function blurb(id: string): string {
  return BLURBS[id] ?? "Design note — describes work that is not built.";
}
