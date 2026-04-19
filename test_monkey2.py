import asyncio
import websockets
import websockets.http11
from http import HTTPStatus
import logging

logging.basicConfig(level=logging.DEBUG)

orig_parse = websockets.http11.Request.parse

def _patched_parse(cls, read_line):
    # Copied from original, but allow HEAD
    try:
        request_line = yield from websockets.http11.parse_line(read_line)
    except EOFError as exc:
        raise EOFError("connection closed while reading HTTP request line") from exc
    try:
        method, raw_path, protocol = request_line.split(b" ", 2)
    except ValueError:
        raise ValueError(f"invalid HTTP request line: {websockets.http11.d(request_line)}")
    if protocol != b"HTTP/1.1":
        raise ValueError(f"unsupported protocol; expected HTTP/1.1: {websockets.http11.d(request_line)}")
    if method not in (b"GET", b"HEAD"):
        raise ValueError(f"unsupported HTTP method; expected GET; got {websockets.http11.d(method)}")
    path = raw_path.decode("ascii", "surrogateescape")
    headers = yield from websockets.http11.parse_headers(read_line)
    req = cls(path, headers)
    req.method = method.decode("ascii")
    return req

websockets.http11.Request.parse = classmethod(_patched_parse)

async def health_check(connection, request):
    # The actual method expects 2 parameters. 
    # But wait! websockets.serve passes different things based on websockets version or connection type.
    # In async/await websockets 14+, process_request takes (connection, request)
    # The user's code uses `async def health_check(path, request_headers):`, which is the old signature.
    # Let's fix that too. The user's code has `async def health_check(path, request_headers):`.
    if request.path in ("/", "/health"):
        return websockets.http11.Response(HTTPStatus.OK, "OK", websockets.datastructures.Headers(), b"OK\n")
    return None

async def handler(ws):
    await ws.send("hello")

async def main():
    async with websockets.serve(handler, "localhost", 8766, process_request=health_check):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
