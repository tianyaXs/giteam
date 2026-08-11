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

## Fallback
If camera scanning is unavailable, paste QR payload JSON into the fallback textarea and tap `Apply & Authorize`.

## Endpoints used
- `GET /api/v1/health`
- `POST /api/v1/auth/pair`
- `GET /api/v1/repository/list`
- `POST /api/v1/agent/session`（创建会话）/ `GET /api/v1/agent/session`（列出/查询会话）
- `GET /api/v1/agent/messages?sessionId=…`（消息历史）
- `POST /api/v1/agent/prompt`（发送消息）
- `POST /api/v1/agent/abort`（中止运行）
- `GET /api/v1/agent/stream?sessionId=…&runId=…`（SSE 事件流）
- `GET /api/v1/agent/interactions` / `POST /api/v1/agent/interaction/reply`（交互问答）
- `POST /api/v1/agent/auto-approve` / `POST /api/v1/agent/model` / `POST /api/v1/agent/session-options`
- `GET /api/v1/agent/providers` / `GET /api/v1/agent/models`
