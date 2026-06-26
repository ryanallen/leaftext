#!/usr/bin/env node
// seo-gen.mjs
// ---------------------------------------------------------------------------
// Generate the static discovery files for the leaftext.com site from the real
// docs/ tree. Deterministic: same repo state in, byte-identical files out, so
// re-running never churns git. No network, no manifest to maintain.
//
// Produces, at the repo root (the deployed site root):
//   robots.txt       allow the major search + AI crawlers, point at the sitemap
//   sitemap.xml      every canonical page + every Markdown source URL
//   sitemap-md.txt   the Markdown sitemap: one .md URL per line
//   llms.txt         concise index for AI retrieval (titles + .md links)
//   llms-full.txt    fuller enumeration (every page, description, .md source)
//
// Run from anywhere:  node scripts/seo-gen.mjs
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Site identity, derived from the repo so this file stays portable.
const ORIGIN = 'https://' + readFileSync(join(ROOT, 'CNAME'), 'utf8').trim();
const BRAND = 'Leaf Text';
const TAGLINE = 'A desktop reader for Markdown. Open a file. Read it.';
const REPO = 'https://github.com/ryanallen/leaftext';
const OG_IMAGE = existsSync(join(ROOT, 'imgs/leaftext.png')) ? ORIGIN + '/imgs/leaftext.png' : '';

// ---- helpers --------------------------------------------------------------

// Every .md under a folder, recursively, returned as repo-relative POSIX paths
// in sorted order so output is stable across machines.
function findMarkdown(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === '.git' || name === 'node_modules' || name === 'vendor') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...findMarkdown(full));
    else if (name.toLowerCase().endsWith('.md')) out.push(rel(full));
  }
  return out;
}
function rel(full) {
  return relative(ROOT, full).split('\\').join('/');
}

// A readable title built from a file's path, used when the file has no heading.
function titleFromPath(relPath) {
  let slug = relPath.replace(/\/README\.md$/i, '').replace(/\.md$/i, '');
  slug = slug.slice(slug.lastIndexOf('/') + 1);
  slug = slug.replace(/^(?:book|chapter|part|section|vol|volume)-\d+-/i, '');
  const titleCase = (s) =>
    s
      .split('-')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  const [eng, skt] = slug.split('--');
  const main = titleCase(eng || slug);
  return skt ? `${main} (${titleCase(skt)})` : main || relPath;
}

// Pull a human title out of a Markdown file's first heading. Strips a leading
// frontmatter block, then the first `# ...` line, then removes links/images/raw
// HTML/emphasis so the label reads as plain text. Falls back to the path.
function titleOf(relPath) {
  let text = readFileSync(join(ROOT, relPath), 'utf8').replace(/\r\n?/g, '\n');
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---', 4);
    if (end >= 0) text = text.slice(text.indexOf('\n', end + 1) + 1);
  }
  const m = text.match(/^#\s+(.*)$/m);
  if (!m) return titleFromPath(relPath);
  let t = m[1];
  let prev;
  do {
    prev = t;
    t = t.replace(/!\[([^\[\]]*)\]\([^)]*\)/g, '$1');
    t = t.replace(/\[([^\[\]]*)\]\([^)]*\)/g, '$1');
    t = t.replace(/\[([^\[\]]*)\]\[[^\]]*\]/g, '$1');
  } while (t !== prev);
  t = t
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_~`#]/g, '')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t || titleFromPath(relPath);
}

// First real paragraph, flattened to a one-line description.
function summaryOf(relPath) {
  let text = readFileSync(join(ROOT, relPath), 'utf8').replace(/\r\n?/g, '\n');
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---', 4);
    if (end >= 0) text = text.slice(text.indexOf('\n', end + 1) + 1);
  }
  for (const block of text.split(/\n{2,}/)) {
    const line = block.trim();
    if (!line || line.startsWith('#') || line.startsWith('<') || line.startsWith('|') || line.startsWith('>'))
      continue;
    const plain = line
      .replace(/!\[([^\[\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\[\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\[\]]*)\]\[[^\]]*\]/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[*_~`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (plain) return plain.length > 200 ? plain.slice(0, 197) + '...' : plain;
  }
  return '';
}

// The docs SPA route for a file: its path under docs/ without the .md. The root
// README is the site landing; docs/README.md (if any) is the docs index.
function pageUrl(relPath) {
  if (relPath === 'README.md') return ORIGIN + '/';
  if (relPath.startsWith('docs/')) {
    const route = relPath.slice('docs/'.length).replace(/\.md$/i, '');
    if (route === 'README') return ORIGIN + '/docs/';
    return ORIGIN + '/docs/#/' + route;
  }
  return ORIGIN + '/' + relPath;
}
const mdUrl = (relPath) => ORIGIN + '/' + relPath;

// Last commit date (YYYY-MM-DD) for a file: meaningful AND deterministic.
function lastmod(relPath) {
  try {
    const out = execFileSync('git', ['-C', ROOT, 'log', '-1', '--format=%cs', '--', relPath], {
      encoding: 'utf8',
    }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : '';
  } catch (e) {
    return '';
  }
}

const xmlEsc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- gather ---------------------------------------------------------------

const docsMd = existsSync(join(ROOT, 'docs')) ? findMarkdown(join(ROOT, 'docs')) : [];
const allMd = ['README.md', ...docsMd];

const pages = allMd.map((relPath) => ({
  relPath,
  title: titleOf(relPath),
  summary: summaryOf(relPath),
  page: pageUrl(relPath),
  md: mdUrl(relPath),
  lastmod: lastmod(relPath),
}));

// ---- robots.txt -----------------------------------------------------------

const AI_AND_SEARCH_BOTS = [
  'Googlebot',
  'Bingbot',
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'CCBot',
  'PerplexityBot',
  'ClaudeBot',
  'Google-Extended',
];
const robots =
  AI_AND_SEARCH_BOTS.map((ua) => `User-agent: ${ua}\nAllow: /`).join('\n\n') +
  '\n\n' +
  'User-agent: *\nAllow: /\n\n' +
  `Sitemap: ${ORIGIN}/sitemap.xml\n`;
writeFileSync(join(ROOT, 'robots.txt'), robots);

// ---- sitemap.xml ----------------------------------------------------------
// Both the human page URL and the raw .md source for each doc. The .md URLs are
// the JS-free representation crawlers and AI fetchers can read directly.

const urls = [];
for (const p of pages) {
  urls.push({ loc: p.page, lastmod: p.lastmod });
  if (p.md !== p.page) urls.push({ loc: p.md, lastmod: p.lastmod });
}
const seen = new Set();
const sitemap =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls
    .filter((u) => (seen.has(u.loc) ? false : seen.add(u.loc)))
    .map(
      (u) =>
        '  <url>\n    <loc>' +
        xmlEsc(u.loc) +
        '</loc>\n' +
        (u.lastmod ? '    <lastmod>' + u.lastmod + '</lastmod>\n' : '') +
        '  </url>'
    )
    .join('\n') +
  '\n</urlset>\n';
writeFileSync(join(ROOT, 'sitemap.xml'), sitemap);

// ---- sitemap-md.txt -------------------------------------------------------

writeFileSync(join(ROOT, 'sitemap-md.txt'), pages.map((p) => p.md).join('\n') + '\n');

// ---- llms.txt -------------------------------------------------------------

const llms =
  `# ${BRAND}\n\n` +
  `> ${TAGLINE} Source Markdown for every page is linked below.\n\n` +
  '## Pages\n\n' +
  pages.map((p) => `- [${p.title}](${p.md})`).join('\n') +
  '\n';
writeFileSync(join(ROOT, 'llms.txt'), llms);

// ---- llms-full.txt --------------------------------------------------------

const llmsFull =
  `# ${BRAND} — full page index\n\n` +
  `> ${TAGLINE} Every canonical page, its human URL, its raw Markdown source, ` +
  'and a short description. Fetch the .md URLs for clean, JS-free text.\n\n' +
  pages
    .map((p) => {
      const lines = [`## ${p.title}`, `- Page: ${p.page}`, `- Markdown: ${p.md}`];
      if (p.summary) lines.push(`- Summary: ${p.summary}`);
      return lines.join('\n');
    })
    .join('\n\n') +
  '\n';
writeFileSync(join(ROOT, 'llms-full.txt'), llmsFull);

// ---- report ---------------------------------------------------------------

console.log(`seo-gen: ${pages.length} pages for ${ORIGIN}`);
console.log('  robots.txt, sitemap.xml, sitemap-md.txt, llms.txt, llms-full.txt written.');
if (!OG_IMAGE) console.log('  note: no imgs/leaftext.png found for og:image.');
