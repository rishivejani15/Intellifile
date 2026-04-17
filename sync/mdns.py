# pc/sync/mdns.py

import socket
from zeroconf import ServiceInfo, Zeroconf

SERVICE_TYPE = "_intellifil._tcp.local."
SERVICE_NAME = "InteliFil._intellifil._tcp.local."
PORT         = 8765


def get_local_ip() -> str:
    """Get this machine's LAN IP."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    finally:
        s.close()


def start_mdns() -> tuple[Zeroconf, ServiceInfo]:
    """
    Advertise InteliFil on the local network.
    Mobile will discover this automatically.
    """
    ip  = get_local_ip()
    info = ServiceInfo(
        SERVICE_TYPE,
        SERVICE_NAME,
        addresses=[socket.inet_aton(ip)],
        port=PORT,
        properties={"version": "1.0", "device": "pc"},
    )
    zeroconf = Zeroconf()
    zeroconf.register_service(info)
    print(f"[mdns] advertising InteliFil at {ip}:{PORT}")
    return zeroconf, info


def stop_mdns(zeroconf: Zeroconf, info: ServiceInfo):
    zeroconf.unregister_service(info)
    zeroconf.close()