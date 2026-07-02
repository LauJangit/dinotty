#!/usr/bin/env python3
"""
Long-running terminal freeze reproduction test.
Simulates opencode-like TUI behavior: sustained high output over 15+ minutes.

Usage:
    python3 bench/long_running_test.py [--port 28999] [--duration 900]
"""
import asyncio
import json
import time
import argparse
import sys


async def ws_client(url, duration, label):
    """Single WS client: sustained output + periodic input to detect freeze."""
    import websockets

    stats = {
        "bytes": 0,
        "msgs": 0,
        "last_output_at": 0,
        "last_input_at": 0,
        "freeze_count": 0,
        "max_freeze_duration": 0,
        "errors": [],
    }

    try:
        async with websockets.connect(url, max_size=50 * 1024 * 1024) as ws:
            # Wait for shell_info
            await asyncio.wait_for(ws.recv(), timeout=5)
            # Drain initial output
            try:
                while True:
                    await asyncio.wait_for(ws.recv(), timeout=0.5)
            except Exception:
                pass

            start = time.time()
            last_activity = start
            last_input_sent = start
            last_sample = start
            cmd_idx = 0

            # Commands that generate sustained output (like opencode)
            commands = [
                'for i in $(seq 1 500000); do echo "LINE-$i-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789"; done\r',
                'cat /dev/urandom | base64 | head -c 10485760\r',
                'yes "SUSTAINED-OUTPUT-PADDED-DATA-LINE-ABCDEFGHIJKLMNOPQRSTUVWXYZ" | head -n 500000\r',
            ]

            # Input probe: send a marker and check if we get output back
            PROBE_INTERVAL = 30  # Send probe every 30s
            PROBE_TIMEOUT = 10   # If no response in 10s, consider frozen

            last_probe_sent = start
            probe_pending = False
            probe_sent_at = 0

            while time.time() - start < duration:
                now = time.time()

                # Send a command if none is running
                if now - last_activity > 3:
                    cmd = commands[cmd_idx % len(commands)]
                    await ws.send(json.dumps({"type": "input", "data": "\x03"}))
                    await asyncio.sleep(0.1)
                    await ws.send(json.dumps({"type": "input", "data": cmd}))
                    cmd_idx += 1
                    last_activity = now

                # Periodic input probe to detect freeze
                if not probe_pending and now - last_probe_sent >= PROBE_INTERVAL:
                    probe = f"echo __PROBE_{int(now)}__\r"
                    await ws.send(json.dumps({"type": "input", "data": probe}))
                    probe_pending = True
                    probe_sent_at = now
                    last_probe_sent = now

                # Check for freeze
                if probe_pending and now - probe_sent_at > PROBE_TIMEOUT:
                    stats["freeze_count"] += 1
                    freeze_dur = now - probe_sent_at
                    stats["max_freeze_duration"] = max(stats["max_freeze_duration"], freeze_dur)
                    print(f"[{label}] FREEZE DETECTED at {now - start:.0f}s! "
                          f"No output for {freeze_dur:.1f}s (probe timeout)", flush=True)
                    # Try to recover
                    await ws.send(json.dumps({"type": "input", "data": "\x03"}))
                    await asyncio.sleep(0.5)
                    probe_pending = False
                    last_activity = now
                    last_probe_sent = now

                # Read output
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=2)
                    d = json.loads(msg)
                    if d.get("type") == "output":
                        data = d["data"]
                        stats["bytes"] += len(data)
                        stats["msgs"] += 1
                        last_activity = now

                        # Check if probe response arrived
                        if probe_pending and f"__PROBE_{int(probe_sent_at)}__" in data:
                            probe_response_time = now - probe_sent_at
                            probe_pending = False
                            if probe_response_time > 5:
                                print(f"[{label}] SLOW probe response: {probe_response_time:.1f}s "
                                      f"at {now - start:.0f}s", flush=True)

                    elif d.get("type") == "session_exit":
                        print(f"[{label}] Session exited at {now - start:.0f}s", flush=True)
                        break

                except asyncio.TimeoutError:
                    pass

                # Periodic stats
                if now - last_sample >= 30:
                    elapsed = now - start
                    rate = stats["bytes"] / max(elapsed, 1) / 1024
                    print(f"[{label}] {elapsed:.0f}s: {stats['bytes']/1024/1024:.1f} MB | "
                          f"{stats['msgs']} msgs | {rate:.1f} KB/s | "
                          f"freezes: {stats['freeze_count']}", flush=True)
                    last_sample = now

    except Exception as e:
        stats["errors"].append(str(e))
        print(f"[{label}] ERROR: {e}", flush=True)

    return stats


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=28999)
    parser.add_argument("--duration", type=int, default=900,
                        help="Test duration in seconds (default: 900 = 15min)")
    parser.add_argument("--clients", type=int, default=2,
                        help="Number of concurrent clients")
    args = parser.parse_args()

    url = f"ws://127.0.0.1:{args.port}/ws"
    print(f"{'='*70}")
    print(f"LONG-RUNNING FREEZE TEST")
    print(f"  URL: {url}")
    print(f"  Duration: {args.duration}s ({args.duration/60:.0f} min)")
    print(f"  Clients: {args.clients}")
    print(f"{'='*70}\n")

    tasks = [ws_client(url, args.duration, f"client-{i}") for i in range(args.clients)]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    print(f"\n{'='*70}")
    print(f"RESULTS")
    print(f"{'='*70}")

    all_ok = True
    for i, r in enumerate(results):
        if isinstance(r, Exception):
            print(f"  client-{i}: EXCEPTION: {r}")
            all_ok = False
            continue
        print(f"  client-{i}: {r['bytes']/1024/1024:.1f} MB | {r['msgs']} msgs | "
              f"freezes: {r['freeze_count']} | max_freeze: {r['max_freeze_duration']:.1f}s")
        if r["freeze_count"] > 0:
            all_ok = False
        for err in r.get("errors", []):
            print(f"    ERROR: {err}")

    print(f"\n  Overall: {'PASS' if all_ok else 'FAIL'}")


if __name__ == "__main__":
    asyncio.run(main())
