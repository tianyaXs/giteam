#!/usr/bin/env python3
"""Keep a LAN cloud tunnel alive for mobile testing."""
from __future__ import annotations

import base64
import json
import os
import socket
import time
import urllib.request

import websocket

LAN_IP = os.environ.get("GITEAM_LAN_IP", "127.0.0.1")
CLOUD_HTTP = f"http://{LAN_IP}:8787"
CLOUD_WS = f"ws://{LAN_IP}:8787/cloud/v1/tunnel"
CONTROL_HOST = "127.0.0.1"
CONTROL_PORT = 4100
ADMIN = "dev-admin-token-change-me-in-production"

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
        headers={"Content-Type": "application/json", **(headers or {})},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def local_exchange(method: str, path: str, headers: dict, body: bytes):
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


def ensure_link():
    if os.path.exists("/tmp/giteam_cloud_devtoken.txt") and os.path.exists("/tmp/giteam_cloud_access.txt"):
        return open("/tmp/giteam_cloud_devtoken.txt").read().strip()
    begin = http_json(
        "POST",
        f"{CLOUD_HTTP}/cloud/v1/device/link/begin",
        {"deviceName": "lan-tunnel-keepalive", "clientVersion": "0.0.0-lan"},
    )
    complete = http_json(
        "POST",
        f"{CLOUD_HTTP}/cloud/v1/device/link/complete",
        {"linkTicket": begin["linkTicket"]},
    )
    open("/tmp/giteam_cloud_access.txt", "w").write(begin["accessKey"])
    open("/tmp/giteam_cloud_devtoken.txt", "w").write(complete["deviceToken"])
    open("/tmp/giteam_cloud_devid.txt", "w").write(complete["deviceId"])
    open("/tmp/giteam_cloud_ws.txt", "w").write(begin["workspaceId"])
    print("fresh link accessKey=", begin["accessKey"])
    return complete["deviceToken"]


def main():
    token = ensure_link()
    access = open("/tmp/giteam_cloud_access.txt").read().strip()
    devid = open("/tmp/giteam_cloud_devid.txt").read().strip()
    print(f"tunnel keepalive -> {CLOUD_WS}")
    print(f"MOBILE_CLOUD_URL={CLOUD_HTTP}")
    print(f"MOBILE_ACCESS_KEY={access}")
    print(f"MOBILE_DEVICE_ID={devid}")

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

    while True:
        connected = {"ok": False}

        def on_open(_ws):
            connected["ok"] = True
            print("tunnel connected", time.strftime("%H:%M:%S"))

        ws = websocket.WebSocketApp(
            CLOUD_WS,
            header=[f"Authorization: Bearer {token}"],
            on_message=on_message,
            on_open=on_open,
            on_error=lambda _ws, err: print("ws error", err),
            on_close=lambda *_: print("ws closed", time.strftime("%H:%M:%S")),
        )
        # run_forever blocks until disconnect
        ws.run_forever(ping_interval=20)
        print("reconnecting in 2s...")
        time.sleep(2)
        # refresh online via admin
        try:
            devices = http_json(
                "GET",
                f"{CLOUD_HTTP}/cloud/v1/admin/devices",
                headers={"Authorization": f"Bearer {ADMIN}"},
            )
            print("devices:", json.dumps(devices, ensure_ascii=False)[:200])
        except Exception as exc:  # noqa: BLE001
            print("admin poll failed", exc)


if __name__ == "__main__":
    main()
