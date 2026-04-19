import asyncio
import websockets
from http import HTTPStatus

async def health_check(path, request_headers):
    print(f"health_check called with: {path}, type(path)={type(path)}")
    if path in ("/", "/health"):
        return HTTPStatus.OK, [], b"OK\n"
    elif hasattr(path, 'path') and path.path in ("/", "/health"): # this would be if path is request instead! Wait!
        return HTTPStatus.OK, [], b"OK\n"
    return None

async def handler(ws):
    await ws.send("hello")

async def main():
    async with websockets.serve(handler, "localhost", 8767, process_request=health_check):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
