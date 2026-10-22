import asyncio
import json
import threading
import websockets

_clients = set()
_latest_state = {}
_incoming_commands = []
_lock = threading.Lock()
_loop = None

async def _ws_handler(websocket):
    global _clients, _latest_state
    _clients.add(websocket)
    try:
        # Gửi ngay state gần nhất cho client vừa kết nối
        with _lock:
            init_payload = json.dumps({"type": "state", "data": _latest_state})
        await websocket.send(init_payload)

        async for message in websocket:
            try:
                data = json.loads(message)
                with _lock:
                    _incoming_commands.append(data)
            except Exception:
                pass
    except Exception:
        pass
    finally:
        _clients.discard(websocket)

async def _server_coro(host, port):
    async with websockets.serve(_ws_handler, host, port):
        while True:
            await asyncio.sleep(3600)

def _run_server_thread(host, port):
    global _loop
    _loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_loop)
    try:
        _loop.run_until_complete(_server_coro(host, port))
    except Exception as e:
        print(f"[WebSync] Server error: {e}")

def start_sync_server(host="127.0.0.1", port=8765):
    t = threading.Thread(target=_run_server_thread, args=(host, port), daemon=True)
    t.start()
    print(f"[WebSync] Da khoi tao WebSocket Sync Bridge tai ws://{host}:{port}")

def broadcast_state(state_dict):
    global _clients, _latest_state, _loop
    with _lock:
        _latest_state = state_dict.copy()
    
    if not _clients or _loop is None:
        return
    
    payload = json.dumps({"type": "state", "data": state_dict})
    
    # Broadcast asynchronously to all connected websockets
    async def _send_all():
        dead = []
        for ws in list(_clients):
            try:
                await ws.send(payload)
            except Exception:
                dead.append(ws)
        for d in dead:
            _clients.discard(d)

    try:
        asyncio.run_coroutine_threadsafe(_send_all(), _loop)
    except Exception:
        pass

def get_pending_commands():
    global _incoming_commands
    with _lock:
        cmds = list(_incoming_commands)
        _incoming_commands.clear()
        return cmds
