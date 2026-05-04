# Architecture: CDC Lakehouse cho Ride-Hailing Việt Nam — Tuân thủ Decree 13

**Author:** 2A202600495- TRẦN ĐÌNH MINH VƯƠNG
**Topic:** C — CDC từ ride-hailing Việt Nam → Lakehouse (tuân thủ Decree 13)
**Format:** Architecture brief cho design review
**Version:** 1.0

---

## 1. Problem Statement

Team vận hành hệ thống Oracle production của một công ty ride-hailing Việt Nam quy mô lớn. Cần xây dựng lakehouse phục vụ analytics cho đội ngũ analyst (dashboard refresh < 60s sau source commit, ad-hoc query p95 < 1s), đồng thời tuân thủ **Nghị định 13/2023/NĐ-CP** về bảo vệ dữ liệu cá nhân.

**Scale:**
- 100 triệu chuyến/năm (~275K/ngày)
- 30K writes/giây ở peak (dữ liệu GPS, payment, rider/driver PII)
- 30 tỉ events/ngày sau dedup

**Hard constraints:**
- Decree 13: PII (số điện thoại, CMND, GPS) phải được tokenize ngay tại Bronze landing
- Mọi lần đọc PII phải có audit log
- Late-arriving events thường xuyên (mạng yếu ở tỉnh)
- SLA dashboard: 60s từ source commit → visible

**Tại sao khó:**
- CDC từ Oracle ở 30K writes/s vừa là high-throughput vừa là real-time
- Decree 13 yêu cầu tokenize tại Bronze — không phải downstream
- SCD Type 2 cho driver/rider dimension với late data handling phức tạp
- GPS trajectory là time-series, cần windowing hiệu quả

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ORACLE PROD (SCN-based replication)                                        │
│  └── Redo Log ──► Debezium (LogMiner) ──► Kafka (30K msg/s)                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  BRONZE LAYER (Raw Landing)                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐                 │
│  │  trips_bronze  │  │drivers_bronze │  │riders_bronze  │                 │
│  │  (Kafka source)│  │(Kafka source) │  │(Kafka source)│                 │
│  │  _raw payloads │  │  _raw payloads │  │  _raw payloads│                 │
│  │  PII: plaintext│  │  PII: plaintext│  │  PII: plaintext│                │
│  └───────┬────────┘  └───────┬────────┘  └───────┬────────┘                │
│          │                    │                    │                         │
│          └────────────────────┼────────────────────┘                         │
│                             │                                                │
│                        Kafka Topic:                                          │
│   ┌─────────────────────────┴──────────────────────────────────┐          │
│   │  CDC-events-{entity}  (partitioned by entity_id)             │          │
│   │  _change_type: insert / update_before / update_after / delete│          │
│   └─────────────────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ [Tokenization UDF — run at write time]
┌─────────────────────────────────────────────────────────────────────────────┐
│  SILVER LAYER (Tokenized + Validated)                                        │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐                │
│  │  trips_silver  │  │drivers_silver │  │riders_silver  │                │
│  │  PII: tokenized│  │  PII: tokenized│  │  PII: tokenized│                │
│  │  + enriched    │  │  + SCD Type 2  │  │  + SCD Type 2  │                │
│  └───────┬────────┘  └───────┬────────┘  └───────┬────────┘                │
│          │                    │                    │                         │
│          │   MERGE WHEN MATCHED AND src.ts > tgt.ts (late data handling)    │
│          │                    │                    │                         │
│          └────────────────────┼────────────────────┘                         │
│                             │                                                │
│  ┌─────────────────────────┴──────────────────────────────────┐            │
│  │  DELTA CDF enabled: delta.enableChangeDataFeed = true       │            │
│  └─────────────────────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ [Delta CDF → downstream consumers]
┌─────────────────────────────────────────────────────────────────────────────┐
│  GOLD LAYER (Aggregated + Analytic)                                          │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐                  │
│  │ trips_daily    │  │ driver_metrics│  │ rider_metrics │                  │
│  │ (aggregated)   │  │ (by period)   │  │ (by period)   │                  │
│  └───────┬────────┘  └───────────────┘  └───────────────┘                  │
│          │                                                             │
│  ┌───────┴────────────────────────────────────────────────────┐          │
│  │  AUDIT_TABLE: pii_access_log                                │          │
│  │  Columns: who, what_table, what_token, when, purpose,        │          │
│  │           rows_returned, query_id, source_ip                 │          │
│  └─────────────────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ [For analyst dashboards + ad-hoc]
┌─────────────────────────────────────────────────────────────────────────────┐
│  CONSUMERS                                                                    │
│  ├── Databricks SQL Warehouses (dashboard, p95 < 1s)                        │
│  ├── Airflow DAGs (scheduled aggregation jobs)                              │
│  └── OpenLineage → Marquez (lineage tracking)                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Quyết định chính kèm Alternatives đã loại

### Decision 1: Table Format — Delta Lake thay vì Iceberg

| | **Chọn: Delta Lake** | Loại: Iceberg | Loại: Hudi |
|---|---|---|---|
| **Lý do** | CDF native, tích hợp Kafka Connect Debezium mượt, MERGE SQL trực tiếp không cần job phụ | CDF không mạnh bằng; MERGE performance chậm hơn ở 30K writes/s theo benchmark internal | Write path latency cao hơn; MERGE semantics phức tạp hơn cho CDC |
| **Tradeoff** | Vendor lock-in với Databricks (nhưng có Delta UniForm nếu cần migrate) | Không có CDF production-ready tốt | Operation overhead cao |

**Tại sao không Iceberg:** Iceberg có table metadata chain mạnh, nhưng Delta CDF cho phép đọc row-level changes trực tiếp từ transaction log mà không cần scan lại toàn bộ partition. Ở 30K writes/s, đây là latency difference giữa 60s và 5 phút.

---

### Decision 2: Catalog — Unity Catalog / Hive Metastore thay vì Glacier/JDBC

| | **Chọn: Unity Catalog** | Loại: JDBC-based metastore | Loại: No catalog (path-based) |
|---|---|---|---|
| **Lý do** | Row-level access control + audit log native, governance API cho Decree 13 compliance | Performance bottleneck ở 30K writes; không có column-level security | Không track được lineage; không có RBAC — vi phạm Decree 13 audit requirement |
| **Tradeoff** | Cần Databricks premium; nhưng cost justified vì PII audit trail là bắt buộc | Maintenance overhead cao | Không scalable |

**Tại sao không JDBC:** JDBC-based metastore trở thành bottleneck khi 30K concurrent writes tạo 30+ table metadata updates/giây. Unity Catalog dùng distributed metastore, tránh SPoF.

---

### Decision 3: Partitioning Strategy — by date + entity_id (composite) thay vì by entity_id only

| | **Chọn: (date, entity_id) composite** | Loại: entity_id only | Loại: date only |
|---|---|---|---|
| **Lý do** | Query "trips by driver in date range" → partition prune hiệu quả. Dashboard refresh 60s yêu cầu partition pruning đúng | Quá nhiều small files (100M rows/năm → 100M partitions) | Query "all trips Jan 2024" → full scan toàn bộ tháng |
| **Tradeoff** | File count management cần OPTIMIZE hàng ngày | Storage explosion | Query performance unacceptable |

**Tại sao không entity_id only:** 100 triệu trips/năm với entity_id partition → 100M partitions. Mỗi partition < 1MB → catastrophic small file problem, query perf sụp.

---

### Decision 4: PII Tokenization — UDF tại Bronze write time thay vì Silver transformation

| | **Chọn: Tokenize at Bronze landing** | Loại: Tokenize in Silver | Loại: Tokenize in Gold |
|---|---|---|---|
| **Lý do** | Decree 13: PII phải được bảo vệ "từ đầu" — không lưu plaintext ở bất kỳ layer nào. Bronze là single source of truth, không có exception | Sau 60s+ processing, PII đã ở Bronze plaintext quá lâu — không compliant | Quá trễ; analytics teams đã thấy plaintext PII trước khi tokenize |
| **Tradeoff** | UDF computation overhead mỗi write (~5% CPU) | Violates Decree 13 principle | Violates Decree 13 timing requirement |

**Tại sao không Silver:** Nghị định 13 yêu cầu bảo vệ dữ liệu cá nhân "từ khi bắt đầu xử lý." Tokenize ở Silver có nghĩa là Bronze layer đã lưu plaintext PII — không thể defend trong audit.

---

### Decision 5: Late Data Handling — MERGE WHEN MATCHED AND src.ts > tgt.ts thay vìupsert batch window

| | **Chọn: src.ts > tgt.ts conditional** | Loại: Watermark-based microbatch | Loại: Tumbling window with late-arrival drop |
|---|---|---|---|
| **Lý do** | Sự kiện đến muộn (mạng yếu tỉnh xa) được apply đúng vị trí trong timeline mà không cần buffer lớn. Dashboard 60s SLA không bị miss | Watermark-based cần 30-60 phút grace period — violates 60s SLA | Tumbling window drop late events — data loss, unacceptable cho compliance |
| **Tradeoff** | MERGE operation phức tạp hơn; cần source timestamp column | Violates 60s SLA | Violates data completeness requirement |

**Tại sao không watermark-based:** Ride-hailing events từ tỉnh xa có inter-arrival time không predictable. Watermark-based watermark phải set rộng → grace period 30-60 phút → vi phạm 60s SLA cho dashboard.

---

### Decision 6: Audit Table — Append-only PII access log thay vì Trigger-based

| | **Chọn: Append-only audit table** | Loại: Database trigger on PII columns | Loại: Row-level security filter |
|---|---|---|---|
| **Lý do** | Trigger overhead ảnh hưởng write performance (30K writes/s). Append-only log không block writes, query side-effect minimal | 30K writes/s + trigger → bottleneck thấy rõ; trigger logic hard to maintain | Không audit được "ai đọc gì" — chỉ block không cho đọc |
| **Tradeoff** | Query-side enforcement cần application logic; nhưng acceptable vì analytics queries là read-only | Performance non-starter | Không meet Decree 13 audit requirement |

**Tại sao không trigger:** Trigger chạy synchronous với mỗi write — 30K writes/s + trigger = throughput killer. Append-only audit log ghi log bất đồng bộ, không affect write path.

---

## 4. Failure Modes

### Failure Mode 1: Debezium consumer lag > 5 phút ở peak

**Kịch bản:** 30K writes/s peak × network partition → Kafka consumer lag tích lũy. Analyst dashboard staleness > 60s SLA.

**Detection:**
- Datadog dashboard: Kafka consumer group lag metric > 1M messages
- Alert: lag_threshold = 500K messages → PagerDuty

**Rollback:**
1. Scale Kafka partition từ 32 → 64 (thêm parallelism)
2. Tăng Debezium batch.size từ 1024 → 4096 (capture more per poll)
3. Nếu > 2 giờ lag: thực hiện **backfill từ Oracle SCN point-in-time** — chạy batch job đọc SCN tại thời điểm lag start, apply vào Bronze
4. Verify: `SELECT COUNT(*) FROM trips_bronze WHERE processing_timestamp > backfill_start`

**Đặc biệt liên quan Day 18:** Time travel — kiểm tra Bronze table tại version trước lag để verify data completeness.

---

### Failure Mode 2: Late-arriving event overwrite correct data

**Kịch bản:** Driver A hoàn thành trip tại HCM. Event gốc đến đúng giờ. 2 giờ sau, event từ khu vực mạng yếu đến muộn — bị MERGE với condition sai, overwrite trip status.

**Detection:**
- Alert: MERGE conflict count metric (whenMatched updates > threshold)
- Secondary: time-travel compare before/after state

**Rollback:**
1. `RESTORE TABLE trips_silver TO VERSION BEFORE_CONFLICT` — Delta time travel instant rollback
2. Replay Kafka events từ checkpoint gần nhất
3. Điều tra: check network latency histogram cho driver region

**Đặc biệt liên quan Day 18:** ACID transaction — Delta restore là atomic, không partial write visible.

---

### Failure Mode 3: PII tokenization UDF silently fails → plaintext PII in Silver

**Kịch bản:** UDF bug hoặc null handling → phone_number hoặc CMND không được tokenize. Plaintext PII trong Silver layer → vi phạm Decree 13.

**Detection:**
- Automated PII scan job chạy mỗi 15 phút trên Silver layer
- Regex pattern: `\+84[0-9]{9,10}` hoặc `[0-9]{9,12}` (CMND pattern)
- Alert: plaintext PII detected in non-Bronze table

**Rollback:**
1. Immediate: `VACUUM trips_silver RETAIN 0` — loại bỏ exposed version
2. Restore: `RESTORE trips_silver TO VERSION <incident_version - 1>`
3. Fix UDF, re-process từ Bronze
4. Incident report cho Decree 13 compliance team

**Đặc biệt liên quan Day 18:** Schema evolution + deletion vectors — Delta `VACUUM` loại bỏ files chứa plaintext PII đã được overwrite bằng tokenized version.

---

### Failure Mode 4: SCD Type 2 backfill job corruption — duplicate historical rows

**Kịch bản:** Spark job backfill 90 ngày gần nhất cho driver dimension. Job crash giữa chừng → một số driver có 2 active records (isCurrent = true cho cùng driver_id).

**Detection:**
- Scheduled DQ check: `SELECT driver_id FROM drivers_silver GROUP BY driver_id HAVING COUNT(*) WHERE isCurrent = true > 1`
- Alert: duplicate active records > 0

**Rollback:**
1. Stop all downstream jobs consuming drivers_silver
2. `RESTORE drivers_silver TO VERSION_BEFORE_BACKFILL`
3. Validate: DQ check passes
4. Restart backfill job từ checkpoint cuối (Spark checkpoint dir)

**Đặc biệt liên quan Day 18:** Deletion vectors — hiểu cách Delta MERGE viết lại files để detect corruption boundary.

---

## 5. Ước lượng chi phí Back-of-Envelope

### Storage Cost (Monthly)

**Assumptions:**
- 100M trips/năm × avg 2KB/event → ~200GB/ngày raw
- 30K writes/s peak × avg 1.5KB/write → ~40GB/ngày CDC payload
- PII tokenization: 30% compression (token thay vì plaintext phone/CMND)
- Retention: Bronze 7 ngày, Silver 1 năm, Gold 3 năm

**Tier calculation:**

| Layer | Raw Size | Compression | Effective | Price | Monthly |
|---|---|---|---|---|---|
| Bronze (7 days) | 200GB × 7 = 1.4TB | 30% | ~1TB | S3 Standard $0.023/GB | **$23** |
| Silver (1 year) | 200GB × 365 = 73TB | 30% | ~51TB | S3 IA $0.0125/GB | **$638** |
| Gold (3 years) | 50GB × 365 × 3 = ~55TB aggregated | 60% | ~22TB | S3 IA $0.0125/GB | **$275** |
| **Total** | | | | | **$936/tháng** |

### Compute Cost

**Assumptions:**
- Debezium: 3 × m5.xlarge (Kafka connect workers) = $0.19/hr × 3 × 730 = **$416/tháng**
- Databricks SQL Warehouse: 2 × DBU-4 (4XL) = $2.40/DBU × 730 = **$1,752/tháng**
- Spark batch jobs: 50 jobs × 10 min × $0.20/DBU = **$100/tháng**

**Total compute: ~$2,268/tháng**

### Grand Total

| Category | Monthly |
|---|---|
| Storage (S3 tiers) | $936 |
| Compute (Databricks + Kafka) | $2,268 |
| **TOTAL** | **~$3,200/tháng** |

### Validation
- Budget: $8K/month FinOps cap (từ lab constraint, topic E reference)
- This design: ~$3.2K/month → **within budget, có buffer cho growth 50%**

---

## 6. MVP Slice — Tuần 1

### Slice nhỏ nhất shippable

**Mục tiêu:** Chứng minh Debezium → Delta Bronze → Tokenization → Silver MERGE chain hoạt động end-to-end với 1 entity (trips), không có full driver/rider dimension.

### Scope tuần 1:

```
Deliverable: 1 working notebook chạy trên sample data 1M rows

Pipeline components:
1. Mock Oracle CDC events → Kafka topic (sử dụng Databricks notebook generator)
2. Bronze ingestion: raw JSON → Delta table với plaintext PII
3. Tokenization UDF: phone_number → tokenized (mock tokenize function)
4. Silver MERGE: upsert với late data handling condition
5. Delta CDF: enable + verify downstream consumption
6. Basic audit log: append-only pii_access_log table

Not in scope tuần 1:
- Driver/Rider SCD Type 2
- Full 30K writes/s load test
- Multi-region setup
```

### Tuần 1 task breakdown:

| Day | Task | Deliverable |
|---|---|---|
| Day 1 | Setup Kafka + Debezium local stack | Docker compose chạy được |
| Day 2 | Bronze table + tokenization UDF | UDF test pass |
| Day 3 | Silver MERGE + late data logic | MERGE test với late data scenario |
| Day 4 | Delta CDF enable + downstream read | CDF query returns correct changes |
| Day 5 | Audit table + basic DQ check | Notebook demo full pipeline |

### Success criteria:
- ✅ UDF tokenizes Vietnamese phone numbers (+84 prefix) correctly
- ✅ MERGE handles src.ts > tgt.ts condition without double-update
- ✅ CDF query shows insert/update/delete types correctly
- ✅ Audit table captures query metadata
- ✅ End-to-end latency < 5 phút cho 1M row sample

---

## 7. Code Artifact (PoC Reference)

PoC notebook location: `poc/cdc_tokenization_demo.py`

Demo file demonstration:
- Tokenization UDF với mock Vietnamese phone + CMND patterns
- CDC MERGE với late data condition
- Delta CDF consumption pattern

---

## 8. Key References

- Debezium Oracle CDC: https://debezium.io/documentation/reference/3.4/connectors/oracle.html
- Delta Lake CDF: https://docs.databricks.com/aws/en/delta/delta-change-data-feed
- SCD Type 2 Delta Lake: https://mungingdata.com/delta-lake/type-2-scd-upserts/
- Decree 13/2023/NĐ-CP: https://www.ey.com/content/dam/ey-unified-site/ey-com/en-vn/technical/tax/documents/ey-vietnam-legal-update-may-2023-en.pdf
- OpenLineage + Marquez: https://openlineage.io/docs/guides/spark-connector/
