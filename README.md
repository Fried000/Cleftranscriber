# Clef Transcriber

Upload a printed melody staff or a full page of that part, recognize it with Audiveris, and engrave the MusicXML in another clef with OpenSheetMusicDisplay. Clef conversion changes the clef symbols while keeping sounding pitches, durations, key signatures, voices, beams, ties, slurs, grace notes, and articulations in the recognized MusicXML. It does not shift the music by octaves.

Image recognition can still make mistakes. The app lists measures whose rhythm Audiveris could not resolve or whose recognized duration does not fill the bar. A complete bar is not proof that every note is correct. Download editable MusicXML for review in notation software. The sample button tests engraving only.

## Run

Requirements: Node.js 22.18+ and Docker Compose. The pinned Audiveris Linux package is for x86-64.

```bash
npm install
docker compose up --build -d omr
npm run dev
```

Open the Vite URL. Images can be PNG, JPEG, or WEBP, up to 10 MB. The whole image is transcribed unless you select and apply a crop. Keep complete systems, their clefs, and all ledger notes. Multiple successive systems of the same part are supported; piano grand staves are not supported by this converter.

The service normalizes the measured staff spacing to retain small notes on full pages. `OMR_MUSIC_FONT` defaults to `Leland`. It can also be `Bravura`, `Primus`, `FinaleJazz`, or `JazzPerc` to match the source notation. Font matching affects recognition of hollow and whole noteheads. Changing the target clef re-engraves the existing MusicXML without running recognition again.

Rebuild the service after backend changes:

```bash
docker compose up --build -d omr
```

## Native service (Windows)

Install Python 3.11+ and [Audiveris 5.11](https://github.com/Audiveris/audiveris/releases/tag/5.11.0), then run:

```powershell
python -m pip install -r omr-service/requirements.txt
$env:AUDIVERIS_BIN = 'C:\Program Files\Audiveris\Audiveris.exe'
$env:OMR_SERVICE_TOKEN = 'local-omr-secret'
python -m uvicorn app:app --app-dir omr-service --host 127.0.0.1 --port 8001
```

Run `npm run dev` in another terminal. `AUDIVERIS_BIN` can point to a portable copy instead. Audiveris includes its Java runtime. The service uses batch mode and suppresses console windows on Windows.

## Verification

### Connect Vercel to a Windows PC

With native Python dependencies and Audiveris installed, run the following from the project folder in PowerShell:

```powershell
.\scripts\start-omr-tunnel.ps1
```

The launcher also recognizes this workspace's existing portable Audiveris and Python dependencies. Otherwise pass `-PythonPath` and `-AudiverisPath` with your installed executable paths. It starts the service on `127.0.0.1:8001`, verifies the Audiveris health response, and starts a checksum-verified Cloudflare Quick Tunnel. It creates or reuses a private `OMR_SERVICE_TOKEN` in `.env.local`; local Vite uses the same token. Restart Vite if it was already running.

Copy the two values from `.local-omr/vercel.env` into the Vercel project's **Production** environment variables and redeploy. This file contains a secret and is excluded from Git. Do not paste it into chat or commit it. Check the deployed `/api/omr-health` and then upload a score.

Keep the PC awake and connected. A Quick Tunnel's public URL changes after restarting it, requiring an updated Vercel `OMR_SERVICE_URL` and another deployment. For a stable URL, use a named Cloudflare Tunnel with a domain. See [Cloudflare's Quick Tunnel documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

Stop the service and tunnel started by this launcher with:

```powershell
.\scripts\stop-omr-tunnel.ps1
```

### Run checks

```bash
npm test
npm run build
python -m pip install -r omr-service/requirements.txt httpx
python -m unittest discover -s omr-service -v
```

Service tests verify complete MusicXML preservation, timing checks, multipart uploads, staff-scale preparation, and engine invocation. API tests verify that production responses retain the MusicXML and recognition warnings. The optional real-recognition regression reads `OMR_TEST_IMAGE`, pointing to the provided reference screenshot, and verifies the exact opening bar's pitches and eighth-note/rest durations; set `AUDIVERIS_BIN` as above to enable it. It does not certify accuracy of the rest of the score.

## Deployment

Vercel builds the Vite app and runs `api/transcribe.ts`; it cannot host Audiveris inside the static build. Run `omr-service` separately and set server-side `OMR_SERVICE_URL` and matching `OMR_SERVICE_TOKEN`. Use HTTPS and a private token when exposing the service. Development defaults are `http://127.0.0.1:8001` and `local-omr-secret`.

`OMR_SERVICE_URL` accepts either the service base URL or its complete `/transcribe` URL. After changing Vercel environment variables, redeploy to apply them. Open `/api/omr-health` on the Vercel website to check the configured service without uploading music. A working configuration returns `{"status":"ok","engine":"Audiveris"}`; failures report configuration or reachability issues without disclosing the token.

### GitHub Codespaces service URLs

A URL ending in `-8001.app.github.dev` is a forwarded Codespaces port. Vercel does not have your GitHub browser session. An empty 404 from this host can mean the forwarded port is private, the Codespace is stopped, or the service is not listening.

1. Keep the Codespace running and start the service there with `docker compose up --build -d omr`.
2. In the Codespace editor choose **View → Terminal**, then **PORTS** in the bottom panel. If hidden, use the command palette and select **Ports: Focus on Ports View**.
3. Add port `8001` if absent. Right-click it → **Port Visibility → Public**. The local service uses HTTP; Codespaces supplies HTTPS for the external URL.
4. Check the forwarded URL's `/health` endpoint without a GitHub login. It must return the Audiveris JSON above.
5. Set that forwarded base URL as Vercel's `OMR_SERVICE_URL`. Set the same `OMR_SERVICE_TOKEN` used by the Codespace service, then redeploy.

The service still requires its bearer token for transcription after the port is public. Do not use the example development token for a public service. Codespaces forwarding only works while the Codespace and service are running; use an always-running container host for a persistent deployment. See [GitHub's port-forwarding documentation](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace).

Recognition returns MusicXML plus note/measure counts and review warnings. It no longer reduces the score to a list of pitch names and duration labels, which discarded notation and caused incorrect-looking rhythms. The retained VexFlow renderer is used for the four-note sample only.

[Audiveris](https://github.com/Audiveris/audiveris) is licensed under AGPL-3.0. [OpenSheetMusicDisplay](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay) is licensed under BSD-3-Clause. Audiveris is run as a separate, unmodified executable; its source and license are available at the linked project.
