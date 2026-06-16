from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from urllib.parse import parse_qs, urlparse


HOST = "127.0.0.1"
PORT = 16888


pending_payload = {
  "trigger": False
}


def json_bytes(payload):
  return json.dumps(payload, ensure_ascii=False).encode("utf-8")


class TriggerHandler(BaseHTTPRequestHandler):
  def _send_json(self, payload, status=200):
    body = json_bytes(payload)
    self.send_response(status)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(body)))
    self.send_header("Cache-Control", "no-store")
    self.end_headers()
    self.wfile.write(body)

  def _read_json_body(self):
    length = int(self.headers.get("Content-Length", "0") or "0")
    if length <= 0:
      return {}
    raw = self.rfile.read(length)
    try:
      return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
      return {}

  def do_GET(self):
    global pending_payload

    parsed = urlparse(self.path)
    if parsed.path != "/trigger":
      self._send_json({"ok": False, "error": "NOT_FOUND"}, status=404)
      return

    query = parse_qs(parsed.query)
    if query.get("fire", ["0"])[0] == "1":
      pending_payload = {
        "id": "manual-get-fire",
        "trigger": True
      }
      self._send_json({"ok": True, "armed": True, "source": "GET /trigger?fire=1"})
      return

    response = pending_payload
    pending_payload = {"trigger": False}
    self._send_json(response)

  def do_POST(self):
    global pending_payload

    parsed = urlparse(self.path)
    if parsed.path != "/trigger":
      self._send_json({"ok": False, "error": "NOT_FOUND"}, status=404)
      return

    payload = self._read_json_body()
    if payload.get("trigger") is True or payload.get("command") == "start":
      pending_payload = {
        "id": str(payload.get("id") or "manual-post-fire"),
        "trigger": True,
        "options": payload.get("options") if isinstance(payload.get("options"), dict) else {}
      }
      self._send_json({"ok": True, "armed": True, "pending": pending_payload})
      return

    self._send_json({
      "ok": True,
      "armed": False,
      "hint": "POST {'trigger': true} to arm the next poll"
    })

  def log_message(self, format, *args):
    return


if __name__ == "__main__":
  print(f"Trigger server listening on http://{HOST}:{PORT}/trigger")
  print("GET  /trigger           -> return current trigger payload and clear it")
  print("GET  /trigger?fire=1    -> arm one trigger quickly for manual testing")
  print("POST /trigger           -> send {'trigger': true} to arm one trigger")
  HTTPServer((HOST, PORT), TriggerHandler).serve_forever()
