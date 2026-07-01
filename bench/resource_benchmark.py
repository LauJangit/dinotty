#!/usr/bin/env python3
"""
Resource monitoring benchmark: CPU, memory, throughput.
Simulates browser-like WebSocket usage with high-output commands.

Phases:
  1. Idle baseline (30s)
  2. Single client high-output (60s)
  3. 4 concurrent clients (120s)
  4. Idle recovery (30s)
  5. Burst stress, 4 clients (120s)
  6. Cool down (30s)

Usage:
  python3 bench/resource_benchmark.py
"""
import asyncio
import json
import time
import subprocess
import signal
import sys
import os
import threading

SERVER_LOG = "/tmp/dinotty_bench.log"
PID = None


def resource_monitor(results, stop_event):
    """Sample CPU and memory every 1s in a background thread."""
    samples = []
    start = time.time()
    while not stop_event.is_set():
        pid = PID
        if not pid:
            time.sleep(0.5)
            continue
        try:
            out = subprocess.check_output(
                ["ps", "-p", str(pid), "-o", "%cpu=,rss=,vsz="],
                text=True, timeout=2,
            ).strip()
            parts = out.split()
            cpu = float(parts[0])
            rss_mb = float(parts[1]) / 1024
            vsz_mb = float(parts[2]) / 1024
            samples.append((time.time() - start, cpu, rss_mb, vsz_mb))
        except (subprocess.CalledProcessError, Exception):
            pass
        time.sleep(1)
    results["resource"] = samples


async def run_server():
    global PID  # noqa: PLW0603
    env = os.environ.copy()
    env["RUST_LOG"] = "warn"
    with open(SERVER_LOG, "w") as f:
        proc = subprocess.Popen(
            ["cargo", "run"],
            stdout=f,
            stderr=subprocess.STDOUT,
            env=env,
            cwd=os.path.join(os.path.dirname(__file__), ".."),
        )
    PID = proc.pid
    for _ in range(30):
        try:
            import urllib.request

            urllib.request.urlopen("http://127.0.0.1:8999/api/info", timeout=1)
            return proc
        except Exception:
            await asyncio.sleep(0.5)
    proc.kill()
    sys.exit(1)


async def single_client(url, duration, label, results):
    """One WS client sending commands and measuring throughput."""
    import websockets

    stats = {"bytes": 0, "msgs": 0, "samples": []}
    try:
        async with websockets.connect(url, max_size=50 * 1024 * 1024) as ws:
            await asyncio.wait_for(ws.recv(), timeout=5)
            try:
                while True:
                    await asyncio.wait_for(ws.recv(), timeout=0.5)
            except Exception:
                pass

            start = time.time()
            last_sample = start

            commands = [
                'for i in $(seq 1 200000); do echo "L{:06d}-ABCDEFGHIJKLMNOPQRSTUVWXYZ"; done\r',
                "cat /dev/urandom | base64 | head -c 5242880\r",
                'yes "SUSTAINED-OUTPUT-DATA-LINE-PAD-ABCDEFGHIJKLMNOPQRSTUVWXYZ" | head -n 300000\r',
            ]
            cmd_idx = 0

            while time.time() - start < duration:
                cmd = commands[cmd_idx % len(commands)]
                await ws.send(json.dumps({"type": "input", "data": "\x03"}))
                await asyncio.sleep(0.1)
                await ws.send(json.dumps({"type": "input", "data": cmd}))
                cmd_idx += 1

                last_output = time.time()
                while time.time() - start < duration:
                    try:
                        msg = await asyncio.wait_for(ws.recv(), timeout=1)
                        d = json.loads(msg)
                        if d.get("type") == "output":
                            stats["bytes"] += len(d["data"])
                            stats["msgs"] += 1
                            last_output = time.time()
                        elif d.get("type") == "session_exit":
                            break
                    except asyncio.TimeoutError:
                        pass

                    now = time.time()
                    if now - last_sample >= 5:
                        elapsed = now - start
                        rate = stats["bytes"] / max(elapsed, 1) / 1024
                        stats["samples"].append((elapsed, stats["bytes"], stats["msgs"], rate))
                        last_sample = now

                    if time.time() - last_output > 2:
                        break

    except Exception as e:
        stats["error"] = str(e)
    results[label] = stats


async def bench():
    proc = await run_server()
    url = "ws://127.0.0.1:8999/ws"
    results = {}

    stop_event = threading.Event()
    res_results = {}
    mon_thread = threading.Thread(
        target=resource_monitor, args=(res_results, stop_event), daemon=True
    )
    mon_thread.start()

    try:
        print(f"{'='*70}")
        print("RESOURCE + THROUGHPUT BENCHMARK (10 minutes)")
        print(f"{'='*70}\n")

        print("Phase 1: Idle baseline (30s)...")
        await asyncio.sleep(30)

        print("Phase 2: Single client high-output (60s)...")
        await single_client(url, 60, "single", results)

        print("Phase 3: 4 concurrent clients (120s)...")
        tasks = [single_client(url, 120, f"client_{i}", results) for i in range(4)]
        await asyncio.gather(*tasks)

        print("Phase 4: Idle recovery (30s)...")
        await asyncio.sleep(30)

        print("Phase 5: Burst stress, 4 clients (120s)...")
        tasks = [single_client(url, 120, f"burst_{i}", results) for i in range(4)]
        await asyncio.gather(*tasks)

        print("Phase 6: Cool down (30s)...")
        await asyncio.sleep(30)

        stop_event.set()
        mon_thread.join(timeout=5)

        # === REPORT ===
        print(f"\n{'='*70}")
        print("RESULTS")
        print(f"{'='*70}")

        samples = res_results.get("resource", [])
        if samples:
            idle1 = [(t, c, r, v) for t, c, r, v in samples if t < 30]
            single = [(t, c, r, v) for t, c, r, v in samples if 30 <= t < 90]
            multi = [(t, c, r, v) for t, c, r, v in samples if 90 <= t < 210]
            idle2 = [(t, c, r, v) for t, c, r, v in samples if 210 <= t < 240]
            burst = [(t, c, r, v) for t, c, r, v in samples if 240 <= t < 360]
            cool = [(t, c, r, v) for t, c, r, v in samples if t >= 360]

            def stats_for(phase, name):
                if not phase:
                    return
                cpus = [c for _, c, _, _ in phase]
                rss = [r for _, _, r, _ in phase]
                vsz = [v for _, _, _, v in phase]
                print(f"\n  {name}:")
                print(f"    CPU:  avg={sum(cpus)/len(cpus):5.1f}%  max={max(cpus):5.1f}%  min={min(cpus):5.1f}%")
                print(f"    RSS:  avg={sum(rss)/len(rss):6.1f} MB  max={max(rss):6.1f} MB  min={min(rss):6.1f} MB")
                print(f"    VSZ:  avg={sum(vsz)/len(vsz):6.1f} MB  max={max(vsz):6.1f} MB")

            print("\n  RESOURCE USAGE:")
            stats_for(idle1, "Phase 1: Idle baseline")
            stats_for(single, "Phase 2: Single client")
            stats_for(multi, "Phase 3: 4 clients")
            stats_for(idle2, "Phase 4: Idle recovery")
            stats_for(burst, "Phase 5: Burst stress")
            stats_for(cool, "Phase 6: Cool down")

        print("\n  THROUGHPUT:")
        for label, s in results.items():
            dur = max(s["samples"][-1][0], 1) if s["samples"] else 0
            rate = s["bytes"] / max(dur, 1) / 1024
            print(f"    {label}: {s['bytes']/1024/1024:.1f} MB | {s['msgs']} msgs | {rate:.1f} KB/s")

        print(f"\n  TIME SERIES (sampled every ~3s):")
        print(f"  {'Time':>6} | {'CPU%':>6} | {'RSS MB':>8} | {'VSZ MB':>8}")
        print(f"  {'-'*6}-+-{'-'*6}-+-{'-'*8}-+-{'-'*8}")
        for t, c, r, v in samples[::3]:
            print(f"  {t:6.0f} | {c:5.1f}% | {r:7.1f} | {v:7.1f}")

        print(f"\n  Total samples: {len(samples)}")
        print(f"  Total duration: {samples[-1][0]:.0f}s" if samples else "")

    finally:
        stop_event.set()
        proc.send_signal(signal.SIGTERM)
        await asyncio.sleep(1)
        proc.kill()


if __name__ == "__main__":
    asyncio.run(bench())
