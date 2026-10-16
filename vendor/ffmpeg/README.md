# Pinned FFmpeg browser distribution

Runtime JavaScript, class worker, core and WebAssembly are served from this directory. No CDN fallback is used. Package versions match the original application: `@ffmpeg/ffmpeg@0.12.10`, `@ffmpeg/util@0.12.2`, `@ffmpeg/core@0.12.6`.

Recreate using Node.js 22+ from the project directory:

```
node scripts/vendor-ffmpeg.mjs
```

The downloader verifies npm tarballs against pinned SHA-512 integrity values before extracting only ESM JavaScript, WebAssembly and package metadata. It verifies the license file hashes too. Type declarations, source maps, UMD copies and install dependencies are not included. `manifest.json` records the official source URLs, tarball integrity and SHA-256 checksums of each vendored file. Re-running does not delete files.

Two reproducible packaging changes are recorded with original hashes in the manifest: the wrapper's fallback core URL points to the local core instead of the upstream CDN, and package metadata declares `type: module` for the selected ESM files. The WebAssembly binary is unchanged.

## Licensing and corresponding source

The JavaScript wrapper and utilities are MIT licensed (`LICENSE.ffmpeg-wasm-MIT`). The npm metadata declares MIT, but that does **not** describe every library compiled into the core WebAssembly binary. The upstream core build enables GPL components, including x264/x265. FFmpeg's notices and GPL/LGPL texts are included alongside this file.

Exact wrapper/core repository revision recorded for the npm releases:
https://github.com/ffmpegwasm/ffmpeg.wasm/tree/e0d4c62a229ba58ea0c6e6b881e289f2fefe97c4

Corresponding build configuration and component source references:
https://github.com/ffmpegwasm/ffmpeg.wasm/blob/e0d4c62a229ba58ea0c6e6b881e289f2fefe97c4/Dockerfile

FFmpeg source version referenced by that configuration:
https://github.com/FFmpeg/FFmpeg/tree/n5.1.4

Preserve these notices when distributing these files and provide the applicable corresponding source for the compiled GPL/LGPL components. This vendor directory contains the original npm WebAssembly binary with the packaging changes above, not a new core build or a complete corresponding-source archive.
