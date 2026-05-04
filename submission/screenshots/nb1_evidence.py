# NB1 — Delta Lake Basics Evidence
# Run from repo root: .venv/bin/python submission/screenshots/nb1_evidence.py

import sys
sys.path.insert(0, 'notebooks')
import _setup  # noqa: F401
import polars as pl
from deltalake import write_deltalake, DeltaTable
from lakehouse import path, reset
from pathlib import Path

reset(path('bronze', 'llm_calls'))

# 1. Write Delta table
df = pl.DataFrame({
    'id': [1, 2, 3],
    'msg': ['hello', 'world', 'test'],
    'ts': ['2026-01-01 10:00:00'] * 3,
})
dt_path = path('bronze', 'llm_calls')
write_deltalake(dt_path, df.to_arrow())

dt = DeltaTable(dt_path)
log_dir = Path(dt_path) / '_delta_log'
json_files = sorted(log_dir.glob('*.json'))
print('=== NB1 Criterion 1: Delta table + _delta_log/ JSON files ===')
print(f'_delta_log files: {[f.name for f in json_files]}')
print(f'history() versions: {len(dt.history())}')

# 2. Schema enforcement blocks bad write
print('\n=== NB1 Criterion 2: Schema enforcement blocks age=str ===')
try:
    bad_df = pl.DataFrame({'id': [99], 'msg': ['x'], 'ts': ['t'], 'age': ['str']})
    write_deltalake(dt_path, bad_df.to_arrow(), mode='overwrite')
    print('FAIL: schema enforcement did not block bad write')
except Exception as e:
    print(f'Schema enforcement BLOCKED: {str(e)[:120]}')

# 3. Schema merge adds tier column
print('\n=== NB1 Criterion 3: schema_mode=merge adds tier column ===')
df2 = pl.DataFrame({'id': [10], 'msg': ['new'], 'ts': ['2026-01-01'], 'tier': ['gold']})
write_deltalake(dt_path, df2.to_arrow(), mode='append', schema_mode='merge')
dt2 = DeltaTable(dt_path)
schema = dt2.schema().to_pyarrow()
cols = [f.name for f in schema]
print(f'Columns after merge: {cols}')
print(f'tier column present: {"tier" in cols}')
