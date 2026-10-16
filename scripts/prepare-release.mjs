import { mkdir, readFile, readdir, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = process.argv[2] && resolve(process.argv[2]);
if (!destination || destination === resolve(root)) throw new Error('Provide a new output directory outside the source root.');
await mkdir(destination, { recursive: false }); // Never overwrite an existing release.
const manifest = JSON.parse(await readFile(join(root, 'vendor/ffmpeg/manifest.json'), 'utf8'));
for (const entry of manifest.files) {
  const bytes = await readFile(join(root, 'vendor/ffmpeg', entry.path));
  if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
    throw new Error(`Vendor verification failed: ${entry.path}`);
  }
}
const files = ['index.html', 'styles.css', 'favicon.ico', 'favicon.png', 'apple-touch-icon.png'];
async function collect(directory) {
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile()) files.push(path);
  }
}
await collect('src');
await collect('vendor');
const records = [];
for (const path of files) {
  // Browser runtime needs no npm metadata; retain license/provenance as plain text.
  if (path.endsWith('/package.json')) continue;
  const targetPath = path.startsWith('vendor/') && !/\.(js|wasm|json|txt)$/i.test(path) ? `${path}.txt` : path;
  const target = join(destination, targetPath);
  if (relative(destination, target).startsWith('..')) throw new Error('Invalid release path');
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(root, path), target);
  const bytes = await readFile(target);
  records.push({ path: targetPath, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(`${destination}.files.json`, JSON.stringify(records, null, 2) + '\n');
console.log(JSON.stringify({ directory: destination, files: records.length, bytes: records.reduce((sum, file) => sum + file.bytes, 0),
  exceedsWordPress10MiB: records.filter((file) => file.bytes > 10485760).map(({ path, bytes }) => ({ path, bytes })) }, null, 2));
