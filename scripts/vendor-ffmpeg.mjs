// Recreate the pinned browser distribution without npm install or runtime CDN access.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const destination = new URL('../vendor/ffmpeg/', import.meta.url);
const packages = [
  { name: 'ffmpeg', version: '0.12.10', integrity: 'sha512-lVtk8PW8e+NUzGZhPTWj2P1J4/NyuCrbDD3O9IGpSeLYtUZKBqZO8CNj1WYGghep/MXoM8e1qVY1GztTkf8YYQ==' },
  { name: 'util', version: '0.12.2', integrity: 'sha512-ouyoW+4JB7WxjeZ2y6KpRvB+dLp7Cp4ro8z0HIVpZVCM7AwFlHa0c4R8Y/a4M3wMqATpYKhC7lSFHQ0T11MEDw==' },
  { name: 'core', version: '0.12.6', integrity: 'sha512-PrjWBTfGn2WVn9T7wGnzfFwChbqWeZc7tM9vvJZVRadYFUDakfzy7W0LpYC0cvvK0xT82qlBsk38lQhJ/Hps5A==' },
];
const upstream = 'https://raw.githubusercontent.com/ffmpegwasm/ffmpeg.wasm/e0d4c62a229ba58ea0c6e6b881e289f2fefe97c4';
const licenseFiles = [
  { path: 'LICENSE.ffmpeg-wasm-MIT', url: `${upstream}/LICENSE`, sha256: '3e123e29517d76504ffce77b3f8e2ccffd4712493f27694b0aba3e376676459f' },
  { path: 'COPYING.FFmpeg.GPLv2', url: 'https://raw.githubusercontent.com/FFmpeg/FFmpeg/n5.1.4/COPYING.GPLv2', sha256: '8177f97513213526df2cf6184d8ff986c675afb514d4e68a404010521b880643' },
  { path: 'COPYING.FFmpeg.LGPLv2.1', url: 'https://raw.githubusercontent.com/FFmpeg/FFmpeg/n5.1.4/COPYING.LGPLv2.1', sha256: 'b634ab5640e258563c536e658cad87080553df6f34f62269a21d554844e58bfe' },
  { path: 'LICENSE.FFmpeg.md', url: 'https://raw.githubusercontent.com/FFmpeg/FFmpeg/n5.1.4/LICENSE.md', sha256: 'cb48bf09a11f5fb576cddb0431c8f5ed0a60157a9ec942adffc13907cbe083f2' },
];
const manifest = { formatVersion: 1, packages: [], licenses: licenseFiles, patches: [], files: [] };
const output = new Map();
const digest = (buffer, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(buffer).digest(encoding);

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

// Read only regular files with explicitly allowed names; never extract arbitrary archive paths.
function readTarFiles(archive) {
  const result = new Map();
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const size = Number.parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim(), 8);
    const checksum = Number.parseInt(header.subarray(148, 156).toString('ascii').replace(/\0.*$/, '').trim(), 8);
    const actualChecksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > archive.length || actualChecksum !== checksum) {
      throw new Error('Invalid tar archive');
    }
    if (header[156] === 0 || header[156] === 48) result.set(name, archive.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return result;
}

for (const item of packages) {
  const url = `https://registry.npmjs.org/@ffmpeg/${item.name}/-/${item.name}-${item.version}.tgz`;
  const archive = await download(url);
  if (`sha512-${digest(archive, 'sha512', 'base64')}` !== item.integrity) throw new Error(`Integrity mismatch: ${item.name}`);
  const files = readTarFiles(gunzipSync(archive));
  const metadata = JSON.parse(files.get('package/package.json').toString('utf8'));
  if (metadata.name !== `@ffmpeg/${item.name}` || metadata.version !== item.version) throw new Error('Package identity mismatch');
  for (const [name, content] of files) {
    const asset = name.match(/^package\/dist\/esm\/([a-zA-Z0-9_-]+\.(?:js|wasm))$/);
    if (asset) {
      const path = `${item.name}/${asset[1]}`;
      let installed = content;
      if (path === 'ffmpeg/const.js') {
        const source = content.toString('utf8');
        const expected = 'export const CORE_URL = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.js`;';
        if (!source.includes(expected)) throw new Error('Unexpected upstream core URL declaration');
        installed = Buffer.from(source.replace(expected, 'export const CORE_URL = new URL("../core/ffmpeg-core.js", import.meta.url).href;'), 'utf8');
        manifest.patches.push({ path, sourceSha256: digest(content), reason: 'Replace the upstream CDN default with the vendored same-origin core.' });
      }
      output.set(path, installed);
    }
  }
  output.set(`${item.name}/package.json`, Buffer.from(`${JSON.stringify({ ...metadata, type: 'module' }, null, 2)}\n`, 'utf8'));
  manifest.patches.push({ path: `${item.name}/package.json`, sourceSha256: digest(files.get('package/package.json')), reason: 'Declare the selected ESM-only distribution for local Node verification.' });
  const required = item.name === 'core' ? ['ffmpeg-core.js', 'ffmpeg-core.wasm'] : ['index.js'];
  for (const path of required) if (!output.has(`${item.name}/${path}`)) throw new Error(`Missing asset: ${path}`);
  manifest.packages.push({ name: metadata.name, version: item.version, tarball: url, integrity: item.integrity, tarballSha256: digest(archive), declaredLicense: metadata.license, source: metadata.repository });
}
for (const license of licenseFiles) {
  const content = await download(license.url);
  if (digest(content) !== license.sha256) throw new Error(`License integrity mismatch: ${license.path}`);
  output.set(license.path, content);
}
// Validate the whole download set before writing any files. Existing unrelated files are preserved.
for (const [path, content] of [...output].sort(([left], [right]) => left.localeCompare(right, 'en'))) {
  const target = new URL(path, destination);
  await mkdir(new URL('./', target), { recursive: true });
  await writeFile(target, content);
  manifest.files.push({ path, bytes: content.length, sha256: digest(content) });
}
await writeFile(new URL('manifest.json', destination), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Verified and vendored ${manifest.files.length} files (${manifest.files.reduce((sum, file) => sum + file.bytes, 0)} bytes).`);
