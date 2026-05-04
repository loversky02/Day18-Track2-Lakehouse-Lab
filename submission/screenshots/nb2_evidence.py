# NB2 — OPTIMIZE + Z-ORDER Evidence

import sys
sys.path.insert(0, 'notebooks')
import _setup  # noqa: F401
import time, random
import polars as pl
from deltalake import DeltaTable, write_deltalake
from lakehouse import path, reset
import json, os

table_path = path("scratch", "events_smallfiles")
reset(table_path)

random.seed(42)
TARGET_USER = 4242
PAYLOADS = [("p" * 200) + str(i) for i in range(64)]

print("Creating 200 small files...")
for batch in range(200):
    rows = pl.DataFrame({
        "event_id": list(range(batch * 5_000, (batch + 1) * 5_000)),
        "kind": [random.choice(["click", "view", "scroll", "purchase"]) for _ in range(5_000)],
        "user_id": [random.randint(1, 100_000) for _ in range(5_000)],
        "payload": [random.choice(PAYLOADS) for _ in range(5_000)],
    })
    mode = "overwrite" if batch == 0 else "append"
    write_deltalake(table_path, rows.to_arrow(), mode=mode)

dt = DeltaTable(table_path)
files_before = len(dt.files())
print(f'\n=== NB2 Criterion 1: Small-file problem ===')
print(f'Files before OPTIMIZE: {files_before}  (target >= 100)')

def bench(label, runs=3):
    times = []
    n = 0
    for _ in range(runs):
        dt_local = DeltaTable(table_path)
        t0 = time.perf_counter()
        tbl = dt_local.to_pyarrow_table(filters=[("user_id", "=", TARGET_USER), ("kind", "=", "purchase")])
        n = tbl.num_rows
        times.append(time.perf_counter() - t0)
    times.sort()
    median = times[len(times)//2]
    print(f"{label:25s}  count={n}  median={median*1000:6.1f} ms")
    return median

before = bench("BEFORE OPTIMIZE")

print('\n=== NB2 Criterion 2: OPTIMIZE + Z-ORDER ===')
TARGET_SIZE = 256 * 1024
dt = DeltaTable(table_path)
dt.optimize.compact(target_size=TARGET_SIZE)
dt.optimize.z_order(["user_id"], target_size=TARGET_SIZE)
dt = DeltaTable(table_path)
files_after = len(dt.files())
print(f'Files after OPTIMIZE+ZORDER: {files_after}')

after = bench("AFTER OPTIMIZE+ZORDER")
speedup = before / max(after, 1e-6)
print(f'\nSpeedup: {speedup:.1f}x  (target >= 3x)')

log_dir = os.path.join(table_path, "_delta_log")
last_log = sorted(f for f in os.listdir(log_dir) if f.endswith(".json"))[-1]
hits = 0
with open(os.path.join(log_dir, last_log)) as fh:
    for line in fh:
        e = json.loads(line)
        if "add" in e and "stats" in e["add"]:
            stats = json.loads(e["add"]["stats"])
            mn = stats.get("minValues", {}).get("user_id")
            mx = stats.get("maxValues", {}).get("user_id")
            if mn is not None and mn <= TARGET_USER <= mx:
                hits += 1
pruned_ratio = files_after / max(hits, 1)
print(f'Files-pruned ratio: {pruned_ratio:.1f}x  (target >= 10x)')
print(f'[{hits} of {files_after} files cover user_id={TARGET_USER}]')

print(f'\n=== NB2 Criterion 3: File count decreased ===')
print(f'Files: {files_before} -> {files_after}  ({files_before/max(files_after,1):.0f}x fewer)')
