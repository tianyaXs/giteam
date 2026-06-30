# giteam mobile (React Native / Expo)

## Product Flow (current)
1. First screen shows **Scan QR** as primary action.
2. Scan desktop QR card to auto-fill:
   - desktop control URL
   - pair code
   - repo path
3. App auto-pairs and enters chat view.
4. User can create new session, send message, stream response, abort task.

## Run
1. `cd apps/mobile`
2. `npm install`
3. Mobile app: `npm run start`
4. Web debug window (LAN): `npm run web:debug`
   - open `http://<your-computer-ip>:19007`

## Fallback
If camera scanning is unavailable, paste QR payload JSON into the fallback textarea and tap `Apply & Authorize`.

## Endpoints used
- `POST /api/v1/auth/pair`
- `POST /api/v1/opencode/prompt`
- `GET /api/v1/opencode/stream`
- `GET /api/v1/opencode/messages`
- `POST /api/v1/opencode/abort`
