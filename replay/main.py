# # relay/main.py

# import time
# import sqlite3
# import os
# import httpx
# from fastapi import FastAPI, HTTPException
# from pydantic import BaseModel

# app = FastAPI()
# DB_PATH = "relay.db"
# FCM_SERVER_KEY = os.getenv("FCM_SERVER_KEY", "")  # set in Railway env vars


# # ─── DB Setup ─────────────────────────────────────────────────────────────────

# def get_db():
#     conn = sqlite3.connect(DB_PATH)
#     conn.row_factory = sqlite3.Row
#     return conn


# def init_db():
#     conn = get_db()
#     conn.execute("""
#         CREATE TABLE IF NOT EXISTS pending_deltas (
#             id          INTEGER PRIMARY KEY AUTOINCREMENT,
#             device_from TEXT NOT NULL,
#             device_to   TEXT NOT NULL,
#             filepath    TEXT NOT NULL,
#             deltas      TEXT NOT NULL,
#             clock       TEXT NOT NULL,
#             change_type TEXT NOT NULL,
#             created_at  REAL NOT NULL
#         )
#     """)
#     conn.execute("""
#         CREATE TABLE IF NOT EXISTS device_tokens (
#             device_id   TEXT PRIMARY KEY,
#             fcm_token   TEXT NOT NULL,
#             updated_at  REAL NOT NULL
#         )
#     """)
#     conn.commit()
#     conn.close()


# # ─── Models ───────────────────────────────────────────────────────────────────

# class PushPayload(BaseModel):
#     device_from: str
#     device_to:   str
#     filepath:    str
#     deltas:      list
#     clock:       dict
#     change_type: str


# class RegisterToken(BaseModel):
#     device_id: str
#     fcm_token: str


# # ─── Routes ───────────────────────────────────────────────────────────────────

# @app.post("/push")
# async def push(payload: PushPayload):
#     """PC calls this when mobile is not on same WiFi."""
#     import json
#     conn = get_db()
#     conn.execute("""
#         INSERT INTO pending_deltas
#         (device_from, device_to, filepath, deltas, clock, change_type, created_at)
#         VALUES (?, ?, ?, ?, ?, ?, ?)
#     """, (
#         payload.device_from,
#         payload.device_to,
#         payload.filepath,
#         json.dumps(payload.deltas),
#         json.dumps(payload.clock),
#         payload.change_type,
#         time.time(),
#     ))
#     conn.commit()
#     conn.close()

#     # wake mobile via FCM push notification
#     await notify_device(payload.device_to, payload.filepath)

#     return {"status": "queued"}


# @app.get("/pull")
# async def pull(device_id: str, since: float = 0.0):
#     """Mobile calls this to fetch pending deltas."""
#     import json
#     conn = get_db()
#     rows = conn.execute("""
#         SELECT * FROM pending_deltas
#         WHERE device_to = ? AND created_at > ?
#         ORDER BY created_at ASC
#     """, (device_id, since)).fetchall()

#     # delete after delivery — relay is not permanent storage
#     if rows:
#         ids = [row["id"] for row in rows]
#         conn.execute(
#             f"DELETE FROM pending_deltas WHERE id IN ({','.join('?'*len(ids))})",
#             ids
#         )
#         conn.commit()
#     conn.close()

#     return {
#         "deltas": [
#             {
#                 "filepath":    row["filepath"],
#                 "deltas":      json.loads(row["deltas"]),
#                 "clock":       json.loads(row["clock"]),
#                 "change_type": row["change_type"],
#                 "from":        row["device_from"],
#             }
#             for row in rows
#         ]
#     }


# @app.post("/register_token")
# async def register_token(payload: RegisterToken):
#     """Mobile registers its FCM token so relay can wake it up."""
#     conn = get_db()
#     conn.execute("""
#         INSERT INTO device_tokens (device_id, fcm_token, updated_at)
#         VALUES (?, ?, ?)
#         ON CONFLICT(device_id) DO UPDATE SET
#             fcm_token  = excluded.fcm_token,
#             updated_at = excluded.updated_at
#     """, (payload.device_id, payload.fcm_token, time.time()))
#     conn.commit()
#     conn.close()
#     return {"status": "registered"}


# @app.get("/health")
# async def health():
#     return {"status": "ok", "time": time.time()}


# # ─── FCM Notification ─────────────────────────────────────────────────────────

# async def notify_device(device_id: str, filepath: str):
#     """Send FCM push to wake mobile when a delta is waiting."""
#     if not FCM_SERVER_KEY:
#         return  # FCM not configured, mobile will poll instead

#     conn = get_db()
#     row = conn.execute(
#         "SELECT fcm_token FROM device_tokens WHERE device_id=?",
#         (device_id,)
#     ).fetchone()
#     conn.close()

#     if not row:
#         return  # mobile hasn't registered its token yet

#     async with httpx.AsyncClient() as client:
#         await client.post(
#             "https://fcm.googleapis.com/fcm/send",
#             headers={
#                 "Authorization": f"key={FCM_SERVER_KEY}",
#                 "Content-Type":  "application/json",
#             },
#             json={
#                 "to": row["fcm_token"],
#                 "data": {
#                     "type":     "delta_waiting",
#                     "filepath": filepath,
#                 },
#                 "priority": "high",
#             }
#         )


# # ─── Startup ──────────────────────────────────────────────────────────────────

# @app.on_event("startup")
# async def startup():
#     init_db()
#     print("[relay] InteliFil relay server ready")


# if __name__ == "__main__":
#     import uvicorn
#     uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)