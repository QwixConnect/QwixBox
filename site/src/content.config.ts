import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";

// Read the repository's own markdown rather than a copy. A second copy of mvp.md would be wrong
// within a week, and this project has been bitten by duplicated sources before.
// No schema: these files have no frontmatter, so titles come from TITLES in the route.
export const collections = {
  docs: defineCollection({
    loader: glob({ pattern: ["*.md", "design/*.md"], base: "../docs" }),
  }),
};
