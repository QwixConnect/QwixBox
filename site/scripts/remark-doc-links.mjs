import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const docs = resolve(repo, 'docs');

// Repository Markdown stays usable on GitHub; published links target generated routes.
export default function remarkDocLinks() {
  return (tree, file) => {
    function walk(node) {
      if (typeof node.url === 'string' && !/^(?:[a-z]+:|\/|#)/i.test(node.url) && /\.md(?:#|$)/.test(node.url)) {
        const [target, anchor] = node.url.split('#');
        const absolute = resolve(dirname(file.path), target);
        const local = relative(docs, absolute);
        node.url = local !== '..' && !local.startsWith(`..${sep}`)
          ? `/docs/${local.replace(/\.md$/, '').split(sep).join('/')}/${anchor ? `#${anchor}` : ''}`
          : `https://github.com/QwixConnect/QwixBox/blob/main/${relative(repo, absolute).split(sep).join('/')}${anchor ? `#${anchor}` : ''}`;
      }
      for (const child of node.children ?? []) walk(child);
    }
    walk(tree);
  };
}
