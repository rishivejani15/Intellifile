# python/main.py

import os
import socket
import json
import threading
from delta_apply import (
    apply_delta, compute_delta,
    get_all_block_checksums, get_clock, merge_clock
)
from reingestion import reingest_file
from watcher import get_state

PORT = int(os.environ.get('INTELLIFIL_PORT', '9000'))


def handle_command(cmd: dict) -> dict:
    """Route command from Flutter to correct Python function."""
    fn = cmd.get('fn')
    args = cmd.get('args', [])

    dispatch = {
        'get_state':              lambda: get_state(args[0]),
        'get_all_block_checksums': lambda: get_all_block_checksums(args[0]),
        'apply_delta':            lambda: apply_delta(args[0], args[1]) or 'ok',
        'compute_delta':          lambda: compute_delta(args[0], args[1]),
        'get_clock':              lambda: get_clock(args[0]),
        'merge_clock':            lambda: merge_clock(args[0], args[1]) or 'ok',
        'reingest_file':          lambda: reingest_file(args[0]) or 'ok',
    }

    if fn not in dispatch:
        return {'error': f'unknown function: {fn}'}

    try:
        result = dispatch[fn]()
        return {'result': result}
    except Exception as e:
        return {'error': str(e)}


def client_thread(conn):
    with conn:
        buf = b''
        while True:
            chunk = conn.recv(4096)
            if not chunk:
                break
            buf += chunk
            # messages delimited by newline
            while b'\n' in buf:
                line, buf = buf.split(b'\n', 1)
                try:
                    cmd = json.loads(line.decode())
                    response = handle_command(cmd)
                    conn.sendall(json.dumps(response).encode() + b'\n')
                except Exception as e:
                    conn.sendall(json.dumps({'error': str(e)}).encode() + b'\n')


def main():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(('127.0.0.1', PORT))
    server.listen(5)
    print(f'[python] listening on port {PORT}')

    while True:
        conn, _ = server.accept()
        threading.Thread(target=client_thread, args=(conn,), daemon=True).start()


if __name__ == '__main__':
    main()