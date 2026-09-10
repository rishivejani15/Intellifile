# pc/sync/mdns.py

import socket
    
try:
    from zeroconf import ServiceInfo, Zeroconf, InterfaceChoice
    _ZEROCONF_AVAILABLE = True
except Exception:
    ServiceInfo = None
    Zeroconf = None
    InterfaceChoice = None
    _ZEROCONF_AVAILABLE = False

SERVICE_TYPE = "_intellifile._tcp.local."
SERVICE_NAME = "IntelliFile._intellifile._tcp.local."
PORT         = 8765


def get_all_local_ips() -> list[str]:
    """
    Get all active local IPv4 addresses completely offline without requiring internet.
    Prioritizes hotspot networks:
      - 192.168.137.x (Windows Mobile Hotspot)
      - 192.168.43.x  (Android Mobile Hotspot)
      - 172.20.10.x   (iOS Personal Hotspot)
      - other private subnets (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
    """
    found: dict[str, str] = {}

    try:
        import ifaddr
        for adapter in ifaddr.get_adapters():
            for ip in adapter.ips:
                if isinstance(ip.ip, str):
                    addr = ip.ip
                    if not addr.startswith("127.") and not addr.startswith("169.254.") and not addr.startswith("0."):
                        found[addr] = adapter.nice_name or adapter.name
    except Exception:
        pass

    try:
        host = socket.gethostname()
        for addr in socket.gethostbyname_ex(host)[2]:
            if not addr.startswith("127.") and not addr.startswith("169.254.") and not addr.startswith("0.") and addr not in found:
                found[addr] = "hostname_lookup"
    except Exception:
        pass

    # Dummy routing probes against private hotspot subnets (offline routing table inspection, sends zero packets)
    for probe_target in [("192.168.137.254", 80), ("192.168.43.254", 80), ("172.20.10.254", 80), ("10.255.255.254", 80)]:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(probe_target)
            ip = s.getsockname()[0]
            s.close()
            if not ip.startswith("127.") and not ip.startswith("169.254.") and not ip.startswith("0.") and ip not in found:
                found[ip] = "probe"
        except Exception:
            pass

    def _score(ip: str) -> int:
        if ip.startswith("192.168.137."): return 0  # Windows Mobile Hotspot host
        if ip.startswith("192.168.43."):  return 1  # Android Hotspot
        if ip.startswith("172.20.10."):   return 2  # iOS Hotspot
        if ip.startswith("192.168."):     return 3  # Standard home / office LAN
        if ip.startswith("10."):          return 4  # Class A LAN
        if ip.startswith("172."):         return 5  # Class B LAN
        return 6

    sorted_ips = sorted(found.keys(), key=_score)
    return sorted_ips if sorted_ips else ["127.0.0.1"]


def get_local_ip() -> str:
    """Get this machine's primary local IP (prioritizing hotspot connections)."""
    return get_all_local_ips()[0]


def start_mdns() -> tuple[Zeroconf, ServiceInfo]:
    """
    Advertise IntelliFile on all active network interfaces simultaneously.
    Mobile will discover this automatically over Hotspot or LAN.
    """
    if not _ZEROCONF_AVAILABLE:
        print("[mdns] zeroconf not installed; mDNS advertising disabled")
        return None, None

    all_ips = get_all_local_ips()
    primary_ip = all_ips[0]
    print(f"[mdns] detected local ips: {all_ips} (primary: {primary_ip})")
    print(f"[mdns] service name: {SERVICE_NAME}")

    addresses = []
    for ip in all_ips:
        try:
            addresses.append(socket.inet_aton(ip))
        except Exception:
            pass

    if not addresses:
        addresses = [socket.inet_aton("127.0.0.1")]

    info = ServiceInfo(
        SERVICE_TYPE,
        SERVICE_NAME,
        addresses=addresses,
        port=PORT,
        properties={"version": "1.0", "device": "pc"},
    )

    try:
        if InterfaceChoice:
            zeroconf = Zeroconf(interfaces=InterfaceChoice.All)
        else:
            zeroconf = Zeroconf()
    except Exception as exc:
        print(f"[mdns] fallback to default Zeroconf interface due to: {exc!r}")
        zeroconf = Zeroconf()

    try:
        zeroconf.register_service(info, allow_name_change=True, cooperating_responders=True)
    except Exception as exc:
        import os, time
        unique_name = f"IntelliFile-{os.getpid()}-{int(time.time()) % 10000}.{SERVICE_TYPE}"
        print(f"[mdns] collision or error with primary name ({exc!r}); registering unique name: {unique_name}")
        info = ServiceInfo(
            SERVICE_TYPE,
            unique_name,
            addresses=addresses,
            port=PORT,
            properties={"version": "1.0", "device": "pc"},
        )
        zeroconf.register_service(info, allow_name_change=True, cooperating_responders=True)

    print(f"[mdns] advertising IntelliFile at {all_ips}:{PORT}")
    return zeroconf, info


def stop_mdns(zeroconf: Zeroconf, info: ServiceInfo):
    if not zeroconf or not info:
        return
    try:
        zeroconf.unregister_service(info)
    except Exception:
        pass
    try:
        zeroconf.close()
    except Exception:
        pass


if __name__ == "__main__":
    import time
    print("\n[mdns] Detecting local and hotspot IP addresses...", flush=True)
    ips = get_all_local_ips()
    for idx, ip in enumerate(ips):
        print(f"  [{idx + 1}] {ip}", flush=True)
    print(f"\n[mdns] Primary IP chosen: {get_local_ip()}", flush=True)

    print("\n[mdns] Starting mDNS service advertisement...", flush=True)
    z, info = start_mdns()
    if z:
        print("\n[mdns] Service is broadcasting! Press Ctrl+C to stop.", flush=True)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n[mdns] Stopping...", flush=True)
            stop_mdns(z, info)
            print("Done.", flush=True)
    else:
        print("[mdns] Could not start mDNS.", flush=True)