# NB4 — Medallion Pipeline Evidence

import sys
sys.path.insert(0, 'notebooks')
import _setup  # noqa: F401
import polars as pl
import duckdb
from deltalake import DeltaTable, write_deltalake
from lakehouse import path, reset
import os

BRONZE = path("bronze", "llm_calls_raw")
SILVER = path("silver", "llm_calls")
GOLD   = path("gold",   "llm_daily_metrics")

bronze_n = DeltaTable(BRONZE).to_pyarrow_table().num_rows
print(f'=== NB4 Criterion 1: Bronze/Silver/Gold on disk ===')
print(f'Bronze: {bronze_n:,} rows — {BRONZE}')
print(f'  exists: {os.path.exists(BRONZE)}')

reset(SILVER)
silver_arrow = duckdb.sql(f"""
    WITH parsed AS (
      SELECT
        request_id,
        ts,
        CAST(ts AS DATE)                            AS date,
        json_extract_string(raw_json, '$.model')          AS model,
        json_extract_string(raw_json, '$.user_id')        AS user_id,
        CAST(json_extract(raw_json, '$.usage.input')  AS INTEGER) AS prompt_tokens,
        CAST(json_extract(raw_json, '$.usage.output') AS INTEGER) AS completion_tokens,
        CAST(json_extract(raw_json, '$.latency_ms')   AS INTEGER) AS latency_ms,
        json_extract_string(raw_json, '$.status')         AS status,
        ROW_NUMBER() OVER (PARTITION BY request_id ORDER BY ts) AS rn
      FROM delta_scan('{BRONZE}')
    )
    SELECT request_id, ts, date, model, user_id,
           prompt_tokens, completion_tokens, latency_ms, status
    FROM parsed
    WHERE rn = 1 AND model IS NOT NULL
""").arrow()
write_deltalake(SILVER, silver_arrow, mode="overwrite", partition_by=["date"])
silver_n = DeltaTable(SILVER).to_pyarrow_table().num_rows
print(f'Silver: {silver_n:,} rows — {SILVER}')
print(f'  exists: {os.path.exists(SILVER)}')

reset(GOLD)
COST_TABLE = """
  VALUES
    ('claude-haiku-4-5',  0.80,  4.00),
    ('claude-sonnet-4-6', 3.00, 15.00),
    ('claude-opus-4-7', 15.00, 75.00)
"""
gold_arrow = duckdb.sql(f"""
    WITH cost(model, c_in, c_out) AS ({COST_TABLE})
    SELECT
      s.date,
      s.model,
      QUANTILE_CONT(s.latency_ms, 0.50) AS p50_latency_ms,
      QUANTILE_CONT(s.latency_ms, 0.95) AS p95_latency_ms,
      SUM(s.prompt_tokens)              AS total_prompt_tokens,
      SUM(s.completion_tokens)          AS total_completion_tokens,
      AVG(CASE WHEN s.status <> 'ok' THEN 1.0 ELSE 0.0 END) AS error_rate,
      (SUM(s.prompt_tokens)     * c.c_in  / 1e6) +
      (SUM(s.completion_tokens) * c.c_out / 1e6) AS cost_usd
    FROM delta_scan('{SILVER}') s
    JOIN cost c USING (model)
    GROUP BY s.date, s.model, c.c_in, c.c_out
    ORDER BY s.date, s.model
""").arrow()
write_deltalake(GOLD, gold_arrow, mode="overwrite", partition_by=["date"])
DeltaTable(GOLD).optimize.z_order(["model"])

gold_df = pl.from_arrow(DeltaTable(GOLD).to_pyarrow_table())
print(f'Gold: {gold_df.height} rows — {GOLD}')
print(f'  exists: {os.path.exists(GOLD)}')

print(f'\n=== NB4 Criterion 2: Silver < Bronze (dedup worked) ===')
print(f'Bronze: {bronze_n:,}  Silver: {silver_n:,}  (Silver < Bronze: {silver_n < bronze_n})')

print(f'\n=== NB4 Criterion 3: Gold >= 7 dates x 3 models ===')
n_dates = gold_df.select("date").n_unique()
n_models = gold_df.select("model").n_unique()
print(f'Distinct dates: {n_dates}  (target >= 7)')
print(f'distinct models: {n_models}')
print(f'total Gold rows: {gold_df.height}  (= dates x models)')
print(gold_df.to_string())

print(f'\n=== NB4 Criterion 4: p50/p95/cost/error_rate populated ===')
print(f'p50_latency_ms non-zero: {gold_df["p50_latency_ms"].sum() > 0}')
print(f'p95_latency_ms non-zero: {gold_df["p95_latency_ms"].sum() > 0}')
print(f'cost_usd non-zero: {gold_df["cost_usd"].sum() > 0:.4f}')
print(f'error_rate populated: {gold_df["error_rate"].mean():.4f} (avg)')
