import { writeFile, mkdir } from 'node:fs/promises';
import { config } from 'dotenv';

// .envファイルを読み込む（ローカル開発時のみ）
config();

const GITHUB_USER = 'TOHFU';
const NOTE_CREATOR = 'tohfu_tronica';
const OUT = new URL('../data/items.json', import.meta.url);
const DEEPL_API_URL = 'https://api-free.deepl.com/v2/translate';

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

/**
 * DeepL APIでテキストを英訳（バッチ処理）
 * @param {string[]} texts - 翻訳するテキストの配列
 * @returns {Promise<string[]>} 翻訳結果の配列
 */
async function translateTexts(texts) {
  if (!process.env.DEEPL_API_KEY) {
    console.warn('DEEPL_API_KEY not set, skipping translation');
    return texts; // 英訳なしで元のテキストを返す
  }

  const params = new URLSearchParams();
  for (const text of texts) {
    params.append('text', text);
  }
  params.append('target_lang', 'EN-US');
  params.append('source_lang', 'JA');

  const res = await fetch(DEEPL_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`DeepL API error ${res.status}: ${error}`);
  }

  const json = await res.json();
  return json.translations.map((t) => t.text);
}

const [github, note] = await Promise.allSettled([fetchGithub(), fetchNote()]);
if (github.status === 'rejected') console.error('github failed:', github.reason);
if (note.status === 'rejected') console.error('note failed:', note.reason);

// 片方でも失敗した場合は、前回のJSONを壊さないよう書き込まずに失敗させる
if (github.status === 'rejected' || note.status === 'rejected') process.exit(1);

const items = [...github.value, ...note.value];

// 全テキストを一括で翻訳
console.log(`translating ${items.length} texts...`);
const textsToTranslate = items.map((item) => item.text);
const translatedTexts = await translateTexts(textsToTranslate);

// 翻訳結果をアイテムに追加
const itemsWithTranslation = items.map((item, index) => ({
  text: item.text,
  textEn: translatedTexts[index],
  url: item.url,
}));

await mkdir(new URL('./', OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(itemsWithTranslation, null, 2) + '\n');
console.log(`wrote ${itemsWithTranslation.length} items with translations`);
