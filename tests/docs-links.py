#!/usr/bin/env python3
"""Check repository Markdown targets and optional built-site links without network access."""
import argparse
from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote, urlsplit

repo = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--site-dir', type=Path, help='Also check generated HTML links and anchors')
args = parser.parse_args()
errors = []
count = 0

# Include new documentation before it is staged; avoid dependency/generated directories.
files = set(repo.glob('*.md')) | set((repo / 'docs').rglob('*.md'))
tracked = subprocess.check_output(['git', 'ls-files', '*.md'], cwd=repo, text=True)
files.update(repo / name for name in tracked.splitlines() if (repo / name).is_file())
for path in sorted(files):
    text = re.sub(r'^\s*(```|~~~).*?^\s*\1\s*$', '', path.read_text(), flags=re.M | re.S)
    links = re.findall(r'\]\((<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)', text)
    links += re.findall(r'^\[[^\]]+\]:\s*(\S+)', text, flags=re.M)
    for target in links:
        url = urlsplit(target.strip('<>'))
        if url.scheme or url.netloc or not url.path or url.path.startswith('/'):
            continue
        count += 1
        if not (path.parent / unquote(url.path)).exists():
            errors.append(f'{path.relative_to(repo)}: missing {target}')
print(f'Checked {count} local Markdown targets across {len(files)} documents')

class Page(HTMLParser):
    def __init__(self, path):
        super().__init__()
        self.ids = set()
        self.links = []
        self.feed(path.read_text())

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'):
            self.ids.add(attrs['id'])
        if tag == 'a' and attrs.get('href'):
            self.links.append(attrs['href'])

if args.site_dir:
    root = args.site_dir.resolve()
    pages = {path.resolve(): Page(path) for path in root.rglob('*.html')}
    if not pages:
        errors.append(f'No HTML pages in {root}')
    checked = 0
    for path, page in pages.items():
        for target in page.links:
            url = urlsplit(target)
            if url.scheme or url.netloc:
                continue
            checked += 1
            dest = ((root / unquote(url.path).lstrip('/')) if url.path.startswith('/')
                    else (path.parent / unquote(url.path))) if url.path else path
            if dest.is_dir():
                dest /= 'index.html'
            dest = dest.resolve()
            if not dest.exists():
                errors.append(f'{path.relative_to(root)}: missing {target}')
            elif url.fragment and dest in pages and unquote(url.fragment) not in pages[dest].ids:
                errors.append(f'{path.relative_to(root)}: missing anchor {target}')
    print(f'Checked {checked} local HTML links/anchors across {len(pages)} pages')

if errors:
    raise SystemExit('\n'.join(errors))
print('PASS documentation links')
