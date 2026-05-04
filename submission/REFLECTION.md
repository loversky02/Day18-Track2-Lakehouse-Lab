# REFLECTION — Anti-Pattern Risk Assessment

**Which anti-pattern from slide §5 would your team's data be most at risk of, and why?**

## Chosen Anti-Pattern: **Late arriving facts / out-of-order event ingestion**

In the LLM observability lakehouse built in this lab, API calls are logged as bronze records with a `ts` timestamp. In production, retries, network jitter, and async batching mean that events frequently arrive seconds to hours after their true event time. If we naively append these to the Silver layer sorted only by `request_id` or `ts` ingestion-order, the resulting Silver table becomes temporally unordered.

This directly violates the **late arriving facts** problem: a success response logged at T=0 might be appended at T=+30 s after a retry failure at T=+29 s that arrived first. Downstream Gold aggregations on `date` buckets will assign the late event to the wrong partition, corrupting p50/p95 latency metrics and cost_usd estimates.

## Why this matters here

The Bronze → Silver pipeline in NB4 uses `PARTITION BY date` and deduplicates by `request_id`, but it does **not** enforce event-time ordering. The `ts` column is taken at face value. In a real system with retries (the 5% duplicate `request_id` rate seeded in `generate_data_lite.py`), events can arrive out of order. Without a watermarking strategy (e.g., event-time windowing + late-event handling), Silver aggregations for a given date can be revision-redated by late writes.

## Mitigation

A production fix would add a **sort-by-event-time + watermarking** step in Silver: buffer events per `request_id` for a grace window, emit only after the watermark passes, and route late events to a separate `silver_late` table for manual review. This keeps Gold aggregations stable and auditable.

---

Submitted for Day 18 Track-2 Lakehouse Lab.
