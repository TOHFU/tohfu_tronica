import { writeFile, mkdir } from 'node:fs/promises';

const GITHUB_USER = 'TOHFU';
const NOTE_CREATOR = 'tohfu_tronica';
const OUT = new URL('../data/items.json', import.meta.url);

async function fetchGithub() {
  const headers = { 'User-Agent': 'tohfu-tronica-build' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/users/${GITHUB_USER}/repos?per_page=100`, { headers });
  if (!res.ok) throw new Error(`github ${res.status}`);
  const repos = await res.json();
  return repos.filter((r) => !r.fork).map((r) => ({ text: r.name, url: r.html_url }));
}

async function fetchNote() {
  const results = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`https://note.com/api/v2/creators/${NOTE_CREATOR}/contents?kind=note&page=${page}`);
    if (!res.ok) throw new Error(`note ${res.status}`);
    const json = await res.json();
    for (const n of json?.data?.contents ?? []) {
      results.push({ text: n.name, url: `https://note.com/${NOTE_CREATOR}/n/${n.key}` });
    }
    if (json?.data?.isLastPage ?? true) break;
  }
  return results;
}

const [github, note] = await Promise.allSettled([fetchGithub(), fetchNote()]);
if (github.status === 'rejected') console.error('github failed:', github.reason);
if (note.status === 'rejected') console.error('note failed:', note.reason);

// 片方でも失敗した場合は、前回のJSONを壊さないよう書き込まずに失敗させる
if (github.status === 'rejected' || note.status === 'rejected') process.exit(1);

const items = [...github.value, ...note.value];
await mkdir(new URL('./', OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(items, null, 2) + '\n');
console.log(`wrote ${items.length} items`);
