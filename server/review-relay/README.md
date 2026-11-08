# Cloud review relay

This optional service lets a reviewer exercise real cloud transcription, translation and microphone transcription using a reusable review access code. The operator's OpenAI key stays on the server. Existing personal-key and local transcription modes remain separate. This implementation is not a deployment and the examples contain no working credentials or public review address.

## Local verification

Use Node 24 and a system `ffmpeg` executable. From this directory:

```sh
npm ci --ignore-scripts
npm test
```

Tests use real local HTTP/WebSocket upstream fixtures, persistent SQLite and ffmpeg. They never contact OpenAI or make paid requests. Production uses only `https://api.openai.com` and `wss://api.openai.com`; upstream overrides are constructor arguments used by offline tests, not environment settings or request parameters.

## Deployment preparation

1. Use a dedicated OpenAI project with the required models, billing and access controls. Add its server key to the VPS secret configuration as `OPENAI_API_KEY`. Never put this key in the APK, this repository, Play review notes, screenshots or logs.
2. Generate an independent random review access code using at least 32 random bytes encoded as base64url. Configure it as `REVIEW_ACCESS_CODE` through the server secret manager. Accepted codes contain 43–128 base64url characters and cannot resemble an OpenAI key. Do not use an example, memorable password, or a personal API key as the code.
3. Copy `.env.example` to the ignored `.env` through a private operator session. Set the actual HTTPS domain and secret values, and set `REVIEW_RELAY_ENABLED=true` only when ready. Keep the default model unless another translation model is intentionally allowlisted through `REVIEW_TRANSLATION_MODELS` (at most four comma-separated names). No user request can expand this list.
4. Use the VPS's existing HTTPS reverse proxy first: forward the new hostname to `127.0.0.1:18080`, preserving WebSocket upgrades and authorization headers, allowing 24 MiB bodies, and setting HTTP deadlines above 180 seconds / WebSocket duration at least 360 seconds. The default Compose service publishes only this loopback port (change `REVIEW_RELAY_LOCAL_PORT` if needed). Do not replace an existing proxy or change other services. An optional `standalone-tls` Compose profile starts the included Caddy example only when ports 80 and 443 are available and no existing proxy serves them. Point the real hostname's DNS to the VPS before enabling HTTPS. Containers use a non-root Node process, read-only image, CPU/memory/PID bounds, temporary RAM storage and a persistent `relay-data` volume for SQLite. Pin deployment image digests and maintain ffmpeg/Node security updates in the operator's environment.
5. Retain the SQLite volume across restarts and upgrades. Do not run replicas with independent databases or delete the database to reset usage. The database must be on local durable storage supporting SQLite locks/WAL; network filesystems are unsuitable. If running without Docker, set an absolute persistent `REVIEW_DB_PATH`, secure its directory, provide system ffmpeg and apply equivalent process/resource restrictions and an HTTPS reverse proxy. `HOST` defaults to loopback outside Docker.
6. Validate real model access and each feature using the intended HTTPS origin and reusable code before adding them to Play Console. Inspect remaining usage through a private SQLite/operator session and ensure sufficient availability throughout review. These steps require actual deployment credentials and paid-service authorization; none have been supplied or executed here.

## Fixed API contract

All four routes require `Authorization: Bearer <review access code>`. The review code is checked locally and never sent upstream. Requests to OpenAI use only the server `OPENAI_API_KEY`; upstream responses and errors are reconstructed or sanitized. The service has no request body, transcript, authorization-header or URL access logging. Configure infrastructure logging to avoid these values too.

| Route | Allowed operation |
| --- | --- |
| `GET /v1/models/:id` | Check one configured translation model or `whisper-1`, `gpt-transcribe`, `gpt-4o-transcribe-diarize`. Returns only a matching model ID. |
| `POST /v1/audio/transcriptions` | Android `OpenAiClient` multipart fields only; no prompts or arbitrary fields. Every upload is decoded and normalized to mono 16 kHz PCM WAV before sending upstream. |
| `POST /v1/responses` | Android's exact subtitle JSON schema and instructions; up to 30 numbered subtitles, 20,000 input characters, and fixed 8,192 output tokens. No tools, prompts, extra models or storage. |
| `WS /v1/realtime?intent=transcription` | Exact `gpt-live-transcribe` session update with mono PCM16 at 24 kHz, optional `ko`, `en`, `ja` or `zh`, audio append and one manual commit. No other events or session fields. |

Uploads are capped at 24 MiB including multipart framing. ffmpeg accepts only a fixed set of media demuxers and `file,pipe` protocols, excluding playlists, concat and network protocols. It decodes at most one second past the planned chunk duration, has a 30-second process deadline and a byte cap, and is killed on a request abort. Duration is counted from decoded PCM bytes, never uploaded metadata. Limits match the Android 420-second chunk plus 500 ms padding on each side (421 seconds), or its 30-second `gpt-transcribe` chunk plus padding (31 seconds), with a further bounded 200 ms allowance for AAC codec frame padding. The actual decoded caps are 421.2 and 31.2 seconds, enforced by PCM byte count; quota reservations round up the entire decoded duration, including any codec padding. The server removes temporary request files on normal completion, invalid media, abort and timeout. An abrupt process/host crash can leave files outside a temporary container filesystem; operators must handle stale files in host deployments.

HTTP attempts have a 180-second total deadline, 45-second request-receive timeout, bounded headers/body/output and four concurrent handlers with at most two audio uploads/decoders. WebSocket upgrades reserve a full 300 seconds before connecting upstream, and reserve it even when the connection fails or the user stops early. A session accepts at most 300 seconds of mono PCM, one commit and a 360-second connection lifetime. It has a 10-second upstream handshake timeout, a 15-second configuration deadline, bounded event/output buffers and at most two concurrent sessions. Disconnects and invalid events close both sides. Session and error payloads never forward upstream credential fields.

## Persistent global quotas

SQLite `BEGIN IMMEDIATE` reservations are atomic across connections, persist over restart and fail closed on storage errors. Failed requests retain their reserved usage. UTC calendar days define the daily window. Clock rollback keeps the last observed day instead of opening a fresh budget; operators must maintain correct system time. Each route/upgrade reserves a request before decoding or contacting OpenAI. Audio reserves rounded-up decoded seconds; translation reserves source text UTF-16 character counts; realtime reserves all 300 seconds up front. Counters contain only day and aggregate use, not access codes, audio, transcripts or translation text.

| Setting | Default per UTC day | Accepted range |
| --- | ---: | ---: |
| `REVIEW_DAILY_REQUESTS` | 100 | 1–1,000 |
| `REVIEW_DAILY_AUDIO_SECONDS` | 3,600 | 1–86,400 |
| `REVIEW_DAILY_REALTIME_SECONDS` | 600 | 1–3,600 |
| `REVIEW_DAILY_TEXT_CHARS` | 60,000 | 1–1,000,000 |

These are global use-unit limits shared by everyone holding the code, not a monetary spending cap or per-person allowance. Defaults allow only two realtime starts per day, including failed/short sessions. File retry attempts, connection checks and other reviewers also consume shared request quotas. Limits do not guarantee availability, model entitlement, billing capacity or completion of long jobs. Monitor aggregate usage and errors privately before and during review; choose sufficient but bounded review budgets. Use the OpenAI project's independent budget/alert controls as appropriate, and rotate the review code if it is disclosed beyond the intended audience.

## Reviewer access notes

Only after the operator has verified the real deployment, provide the actual HTTPS origin and reusable review access code in Play Console's restricted app-access instructions. Do not provide an OpenAI key. The code must work repeatedly without registration, a personal OpenAI account, or payment by the reviewer. Do not submit a made-up code/address or describe untested cloud functionality as verified.

Explain the exact app steps: open API settings, select **Test server**, enter the supplied HTTPS origin and review access code, save and check the connection. Select a short media file and run cloud transcription/translation; start realtime transcription after accepting its microphone and transmission notice. The app displays the test connection and data destination. Provide the operator's tested per-job/session limits and a contact for exhausted shared quotas, and keep the endpoint available for the review period. Verify these labels against the submitted build. Do not use reviewer detection, special hidden behavior, fake API results or fabricated foreground-service evidence.
