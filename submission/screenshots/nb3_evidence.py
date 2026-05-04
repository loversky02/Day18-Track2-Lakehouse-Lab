# NB3 — Time Travel + MERGE + RESTORE Evidence

import sys
sys.path.insert(0, 'notebooks')
import _setup  # noqa: F401
import time
import polars as pl
from deltalake import DeltaTable, write_deltalake
from lakehouse import path, reset

table_path = path("scratch", "customers_tt")
reset(table_path)

# v0 — initial 100K
v0 = pl.DataFrame({
    "customer_id": list(range(100_000)),
    "status":      ["active"] * 100_000,
    "score":       [i % 1000 for i in range(100_000)],
})
write_deltalake(table_path, v0.to_arrow(), mode="overwrite")

# v1 — add tier column
v1 = (pl.from_arrow(DeltaTable(table_path).to_pyarrow_table())
        .with_columns(
            pl.when(pl.col("score") > 800).then(pl.lit("gold")).otherwise(pl.lit("silver")).alias("tier")
        ))
write_deltalake(table_path, v1.to_arrow(), mode="overwrite", schema_mode="overwrite")

# v2 — MERGE upsert 100K
updates = pl.DataFrame({
    "customer_id": list(range(50_000, 150_000)),
    "status":      ["vip"] * 100_000,
    "score":       [999] * 100_000,
    "tier":        ["platinum"] * 100_000,
})
t0 = time.time()
(DeltaTable(table_path)
    .merge(source=updates.to_arrow(),
           predicate="t.customer_id = s.customer_id",
           source_alias="s", target_alias="t")
    .when_matched_update_all()
    .when_not_matched_insert_all()
    .execute())
print(f'=== NB3 Criterion 2: MERGE 100K upsert ===')
print(f'MERGE 100K rows: {time.time()-t0:.2f}s  (target < 60s)')

# v3 — bad data
bad = pl.DataFrame({
    "customer_id": list(range(50)),
    "status":      [None] * 50,
    "score":       [-1] * 50,
    "tier":        ["UNKNOWN"] * 50,
}, schema={"customer_id": pl.Int64, "status": pl.Utf8, "score": pl.Int64, "tier": pl.Utf8})
write_deltalake(table_path, bad.to_arrow(), mode="append")

print('\n=== NB3 Criterion 1: history() >= 5 versions ===')
h = DeltaTable(table_path).history()
print(f'History versions: {len(h)}  (target >= 5)')
for hrecord in h:
    print(f"  v{hrecord['version']:>2}  {hrecord['operation']:<30}")

# RESTORE
t0 = time.time()
DeltaTable(table_path).restore(2)
restore_time = time.time() - t0
print(f'\n=== NB3 Criterion 3: RESTORE < 30s ===')
print(f'RESTORE time: {restore_time:.2f}s  (target < 30s)')

bad_count = DeltaTable(table_path).to_pyarrow_table(filters=[("score", "<", 0)]).num_rows
print(f'Rows with score<0 after restore: {bad_count}  (expected 0)')

print('\n=== NB3 Final history ===')
final_history = DeltaTable(table_path).history()
for hrecord in final_history:
    print(f"  v{hrecord['version']:>2}  {hrecord['operation']:<30}")
print(f'\nTotal versions: {len(final_history)}  (target >= 5)')
