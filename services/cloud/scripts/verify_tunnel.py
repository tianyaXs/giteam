#!/usr/bin/env python3
"""Minimal cloud tunnel client for verification (local Control :4100)."""
from __future__ import annotations

import base64
import json
import socket
import threading
import time
import urllib.request

import websocket

CLOUD = "ws://127.0.0.1:8787/cloud/v1/tunnel"
CONTROL_HOST = "127.0.0.1"
CONTROL_PORT = 4100
DEV_TOKEN = open("/tmp/giteam_cloud_devtoken.txt").read().strip()
LOCAL_AUTH = ""
try:
    import os
    import json as _json

    auth_path = os.path.expanduser("~/Library/Application Support/giteam/control-auth.json")
    LOCAL_AUTH = _json.load(open(auth_path)).get("token") or ""
except Exception:
    LOCAL_AUTH = ""


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


def on_message(ws, message: str):
    frame = json.loads(message)
    t = frame.get("type")
    if t == "http.request":
        stream_id = frame["streamId"]
        body = base64.b64decode(frame.get("bodyBase64") or "") if frame.get("bodyBase64") else b""
        try:
            status, headers, resp = local_exchange(
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
                    "status": status,
                    "headers": headers,
                }
            )
        )
        chunk = base64.b64encode(resp).decode()
        ws.send(
            json.dumps(
                {
                    "v": 1,
                    "type": "http.responseBody",
                    "streamId": stream_id,
                    "chunkBase64": chunk,
                    "end": True,
                }
            )
        )
        ws.send(json.dumps({"v": 1, "type": "http.responseEnd", "streamId": stream_id}))
    elif t == "ping":
        ws.send(json.dumps({"v": 1, "type": "pong", "ts": frame.get("ts", 0)}))


def main():
    ws = websocket.WebSocketApp(
        CLOUD,
        header=[f"Authorization: Bearer {DEV_TOKEN}"],
        on_message=on_message,
        on_error=lambda _ws, err: print("ws error", err),
        on_open=lambda _ws: print("tunnel connected"),
    )
    t = threading.Thread(target=ws.run_forever, kwargs={"ping_interval": 20}, daemon=True)
    t.start()
    # wait until admin sees online
    for _ in range(30):
        req = urllib.request.Request(
            "http://127.0.0.1:8787/cloud/v1/admin/devices",
            headers={"Authorization": "Bearer dev-admin-token-change-me-in-production"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            devices = json.load(resp)
        if devices and devices[0].get("online"):
            print("device online confirmed")
            break
        time.sleep(0.5)
    else:
        print("device never went online")
        return 1

    access = open("/tmp/giteam_cloud_access.txt").read().strip()
    redeem_body = json.dumps({"accessKey": access}).encode()
    req = urllib.request.Request(
        "http://127.0.0.1:8787/cloud/v1/auth/redeem",
        data=redeem_body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        redeemed = json.load(resp)
    token = redeemed["token"]
    print("jwt redeemed")

    # proxied health through cloud
    req = urllib.request.Request(
        "http://127.0.0.1:8787/api/v1/health",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        health = json.load(resp)
    print("cloud health:", json.dumps(health, ensure_ascii=False)[:400])

    # repository list via tunnel
    req = urllib.request.Request(
        "http://127.0.0.1:8787/api/v1/repository/list",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        repos = json.load(resp)
    print("repo count via tunnel:", len(repos) if isinstance(repos, list) else type(repos))

    # agent runtime via tunnel
    req = urllib.request.Request(
        "http://127.0.0.1:8787/api/v1/agent/runtime",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        runtime = json.load(resp)
    print("agent runtime via tunnel:", json.dumps(runtime, ensure_ascii=False)[:300])
    print("VERIFY_OK")
    ws.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
