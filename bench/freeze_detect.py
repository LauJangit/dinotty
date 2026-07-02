#!/usr/bin/env python3
"""
Freeze detection test: sends a probe AFTER each command completes,
so false positives from long-running commands are avoided.
Detects permanent freezes where no output arrives for >30s.
"""
import asyncio
import json
import time
import sys


async def ws_client(url, duration, label):
    import websockets

    stats = {"bytes": 0, "msgs": 0, "freezes": 0, "max_freeze": 0, "errors": []}

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
            last_any_output = start
            last_sample = start

            # Simple commands that finish quickly
            commands = [
                'echo "CMD1_$(date +%s)"\r',
                'echo "CMD2_$(date +%s)"\r',
                'ls /tmp | head -5\r',
                'date\r',
                'uptime\r',
            ]
            cmd_idx = 0
            cmd_sent_at = 0
            FREEZE_THRESHOLD = 30  # seconds without any output = real freeze

            while time.time() - start < duration:
                now = time.time()

                # Send next command every 5 seconds
                if now - cmd_sent_at > 5:
                    cmd = commands[cmd_idx % len(commands)]
                    await ws.send(json.dumps({"type": "input", "data": cmd}))
                    cmd_idx += 1
                    cmd_sent_at = now

                # Check for real freeze (no output for FREEZE_THRESHOLD seconds)
                silence = now - last_any_output
                if silence > FREEZE_THRESHOLD:
                    stats["freezes"] += 1
                    stats["max_freeze"] = max(stats["max_freeze"], silence)
                    print(f"[{label}] *** PERMANENT FREEZE at {now-start:.0f}s! "
                          f"No output for {silence:.0f}s ***", flush=True)
                    # Try sending Ctrl+C to recover
                    await ws.send(json.dumps({"type": "input", "data": "\x03"}))
                    await asyncio.sleep(1)
                    # Check if we got any response
                    try:
                        msg = await asyncio.wait_for(ws.recv(), timeout=2)
                        d = json.loads(msg)
                        if d.get("type") == "output":
                            print(f"[{label}] Recovery: got output after Ctrl+C", flush=True)
                            last_any_output = time.time()
                    except Exception:
                        print(f"[{label}] NO RECOVERY — connection may be dead", flush=True)
                        break

                # Read output
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=2)
                    d = json.loads(msg)
                    if d.get("type") == "output":
                        stats["bytes"] += len(d["data"])
                        stats["msgs"] += 1
                        last_any_output = now
                    elif d.get("type") == "session_exit":
                        print(f"[{label}] Session exited at {now-start:.0f}s", flush=True)
                        break
                except asyncio.TimeoutError:
                    pass

                # Periodic stats
                if now - last_sample >= 30:
                    elapsed = now - start
                    rate = stats["bytes"] / max(elapsed, 1) / 1024
                    print(f"[{label}] {elapsed:.0f}s: {stats['bytes']/1024/1024:.1f} MB | "
                          f"{rate:.1f} KB/s | freezes: {stats['freezes']}", flush=True)
                    last_sample = now

    except Exception as e:
        stats["errors"].append(str(e))
        print(f"[{label}] ERROR: {e}", flush=True)

    return stats


async def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=28999)
    parser.add_argument("--duration", type=int, default=600)
    parser.add_argument("--clients", type=int, default=2)
    args = parser.parse_args()

    url = f"ws://127.0.0.1:{args.port}/ws"
    print(f"{'='*70}")
    print(f"FREEZE DETECTION TEST (threshold: 30s silence)")
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
              f"freezes: {r['freezes']} | max_freeze: {r['max_freeze']:.1f}s")
        if r["freezes"] > 0:
            all_ok = False

    print(f"\n  Overall: {'PASS' if all_ok else 'FAIL'}")


if __name__ == "__main__":
    asyncio.run(main())
