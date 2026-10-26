import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const docs = resolve(repo, 'docs');

// Repository Markdown stays usable on GitHub; published links target generated routes.
export default function remarkDocLinks() {
  return (tree, file) => {
    function walk(node) {
      if (typeof node.url === 'string' && !/^(?:[a-z]+:|\/|#)/i.test(node.url)) {
        const [target, anchor] = node.url.split('#');
        const absolute = resolve(dirname(file.path), target);
        const local = relative(docs, absolute);
        // Only these two levels are loaded by content.config.ts. Research/review files and
        // other repository artifacts must link to GitHub rather than nonexistent site routes.
        const published = /^(?:[^/]+|design\/[^/]+)\.md$/.test(local.split(sep).join('/'));
        node.url = published
          ? `/docs/${local.replace(/\.md$/, '').split(sep).join('/').toLowerCase()}/${anchor ? `#${anchor}` : ''}`
          : `https://github.com/QwixConnect/QwixBox/blob/main/${relative(repo, absolute).split(sep).join('/')}${anchor ? `#${anchor}` : ''}`;
      }
      for (const child of node.children ?? []) walk(child);
    }
    walk(tree);
  };
}
