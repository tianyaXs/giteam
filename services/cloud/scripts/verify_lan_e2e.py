#!/usr/bin/env python3
"""Full cloud-relay e2e over LAN IP (link → tunnel → redeem → proxy APIs)."""
from __future__ import annotations

import base64
import json
import os
import socket
import threading
import time
import urllib.error
import urllib.request

import websocket

LAN_IP = os.environ.get("GITEAM_LAN_IP", "127.0.0.1")
CLOUD_HTTP = os.environ.get("GITEAM_CLOUD_HTTP", f"http://{LAN_IP}:8787")
CLOUD_WS = os.environ.get("GITEAM_CLOUD_WS", f"ws://{LAN_IP}:8787/cloud/v1/tunnel")
ADMIN = os.environ.get("GITEAM_ADMIN_TOKEN", "dev-admin-token-change-me-in-production")
CONTROL_HOST = "127.0.0.1"
CONTROL_PORT = 4100

LOCAL_AUTH = ""
try:
    auth_path = os.path.expanduser("~/Library/Application Support/giteam/control-auth.json")
    LOCAL_AUTH = json.load(open(auth_path)).get("token") or ""
except Exception:
    LOCAL_AUTH = ""


def http_json(method: str, url: str, body: dict | None = None, headers: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Content-Type": "application/json",
            **(headers or {}),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} -> {e.code}: {err}") from e


def local_exchange(method: str, path: str, headers: dict, body: bytes) -> tuple[int, dict, bytes]:
    req_headers = {
        k: v
        for k, v in headers.items()
        if k.lower() not in {"host", "content-length", "connection", "transfer-encoding", "authorization"}
    }
    if LOCAL_AUTH:
        req_headers["Authorization"] = f"Bearer {LOCAL_AUTH}"
    req_headers["Host"] = f"{CONTROL_HOST}:{CONTROL_PORT}"
    req_headers["Connection"] = "close"
    req_headers["Content-Length"] = str(len(body))
    head = f"{method} {path} HTTP/1.1\r\n" + "".join(f"{k}: {v}\r\n" for k, v in req_headers.items()) + "\r\n"
    with socket.create_connection((CONTROL_HOST, CONTROL_PORT), timeout=30) as sock:
        sock.sendall(head.encode() + body)
        raw = b""
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            raw += chunk
    sep = raw.find(b"\r\n\r\n")
    if sep < 0:
        raise RuntimeError("bad local response")
    header_text = raw[:sep].decode("latin1", errors="replace")
    body_out = raw[sep + 4 :]
    lines = header_text.split("\r\n")
    status = int(lines[0].split()[1])
    resp_headers = {}
    for line in lines[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            resp_headers[k.strip()] = v.strip()
    return status, resp_headers, body_out


def main() -> int:
    print(f"LAN base: {CLOUD_HTTP}")

    # 1) healthz via LAN
    status, healthz = http_json("GET", f"{CLOUD_HTTP}/healthz")
    assert status == 200 and healthz and healthz.get("ok") is True, healthz
    print("healthz OK")

    # 2) link begin + complete via LAN
    _, begin = http_json(
        "POST",
        f"{CLOUD_HTTP}/cloud/v1/device/link/begin",
        {"deviceName": "lan-verify-cli", "clientVersion": "0.0.0-lan"},
    )
    assert begin
    qr = begin["qrPayload"]
    cloud_base = qr["cloudBaseUrl"]
    print("qr cloudBaseUrl:", cloud_base)
    if LAN_IP not in cloud_base:
        raise RuntimeError(f"PUBLIC_BASE_URL still not LAN: {cloud_base}")
    if cloud_base.rstrip("/") != CLOUD_HTTP.rstrip("/"):
        print("WARN: qr base != test CLOUD_HTTP", cloud_base, CLOUD_HTTP)

    _, complete = http_json(
        "POST",
        f"{CLOUD_HTTP}/cloud/v1/device/link/complete",
        {"linkTicket": begin["linkTicket"]},
    )
    assert complete
    device_token = complete["deviceToken"]
    device_id = complete["deviceId"]
    access_key = begin["accessKey"]
    workspace_id = begin["workspaceId"]
    print("linked device:", device_id, "workspace:", workspace_id)

    for path, val in [
        ("/tmp/giteam_cloud_access.txt", access_key),
        ("/tmp/giteam_cloud_devtoken.txt", device_token),
        ("/tmp/giteam_cloud_devid.txt", device_id),
        ("/tmp/giteam_cloud_ws.txt", workspace_id),
    ]:
        open(path, "w").write(val)

    # 3) tunnel over LAN WS
    def on_message(ws, message: str):
        frame = json.loads(message)
        t = frame.get("type")
        if t == "http.request":
            stream_id = frame["streamId"]
            body = base64.b64decode(frame.get("bodyBase64") or "") if frame.get("bodyBase64") else b""
            try:
                st, headers, resp = local_exchange(
                    frame["method"], frame["path"], frame.get("headers") or {}, body
                )
            except Exception as exc:  # noqa: BLE001
                ws.send(
                    json.dumps(
                        {
                            "v": 1,
                            "type": "error",
                            "streamId": stream_id,
                            "code": "local_proxy_error",
                            "message": str(exc),
                        }
                    )
                )
                return
            ws.send(
                json.dumps(
                    {
                        "v": 1,
                        "type": "http.responseStart",
                        "streamId": stream_id,
                        "status": st,
                        "headers": headers,
                    }
                )
            )
            ws.send(
                json.dumps(
                    {
                        "v": 1,
                        "type": "http.responseBody",
                        "streamId": stream_id,
                        "chunkBase64": base64.b64encode(resp).decode(),
                        "end": True,
                    }
                )
            )
            ws.send(json.dumps({"v": 1, "type": "http.responseEnd", "streamId": stream_id}))
        elif t == "ping":
            ws.send(json.dumps({"v": 1, "type": "pong", "ts": frame.get("ts", 0)}))

    ws = websocket.WebSocketApp(
        CLOUD_WS,
        header=[f"Authorization: Bearer {device_token}"],
        on_message=on_message,
        on_error=lambda _ws, err: print("ws error", err),
        on_open=lambda _ws: print("tunnel connected via LAN WS"),
    )
    threading.Thread(target=ws.run_forever, kwargs={"ping_interval": 20}, daemon=True).start()

    for _ in range(40):
        _, devices = http_json(
            "GET",
            f"{CLOUD_HTTP}/cloud/v1/admin/devices",
            headers={"Authorization": f"Bearer {ADMIN}"},
        )
        online = [d for d in (devices or []) if d.get("id") == device_id and d.get("online")]
        if online:
            print("device online confirmed via LAN admin")
            break
        time.sleep(0.4)
    else:
        print("device never went online")
        return 1

    # 4) redeem JWT via LAN
    _, redeemed = http_json(
        "POST",
        f"{CLOUD_HTTP}/cloud/v1/auth/redeem",
        {"accessKey": access_key},
    )
    token = redeemed["token"]
    print("jwt redeemed via LAN")

    auth = {"Authorization": f"Bearer {token}", "X-Giteam-Device-Id": device_id}

    # 5) cloud-aggregated health
    _, health = http_json("GET", f"{CLOUD_HTTP}/api/v1/health", headers=auth)
    print("cloud health:", json.dumps(health, ensure_ascii=False)[:400])
    assert health and health.get("ok") is True
    assert health.get("mode") == "cloud"
    assert any(d.get("id") == device_id and d.get("online") for d in health.get("devices") or [])

    # 6) repository list via tunnel
    _, repos = http_json("GET", f"{CLOUD_HTTP}/api/v1/repository/list", headers=auth)
    print("repo count via LAN tunnel:", len(repos) if isinstance(repos, list) else type(repos))
    assert isinstance(repos, list) and len(repos) > 0

    # 7) agent runtime via tunnel
    _, runtime = http_json("GET", f"{CLOUD_HTTP}/api/v1/agent/runtime", headers=auth)
    print("agent runtime:", json.dumps(runtime, ensure_ascii=False)[:300])
    assert runtime and runtime.get("backend")

    # 8) workspace status
    _, ws_status = http_json(
        "GET",
        f"{CLOUD_HTTP}/cloud/v1/workspace/status",
        headers=auth,
    )
    print("workspace status devices:", len((ws_status or {}).get("devices") or []))

    # 9) admin metrics
    _, metrics = http_json(
        "GET",
        f"{CLOUD_HTTP}/cloud/v1/admin/metrics",
        headers={"Authorization": f"Bearer {ADMIN}"},
    )
    print("admin metrics:", json.dumps(metrics, ensure_ascii=False)[:300])

    print("LAN_E2E_OK")
    print(f"MOBILE_CLOUD_URL={CLOUD_HTTP}")
    print(f"MOBILE_ACCESS_KEY={access_key}")
    print(f"MOBILE_DEVICE_ID={device_id}")
    ws.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
