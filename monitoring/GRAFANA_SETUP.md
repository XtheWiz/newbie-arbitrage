# Grafana Dashboard Setup Guide

## Quick Start

After running `docker compose up`, access Grafana at **http://localhost:3000**

**Credentials:**

- Username: `admin`
- Password: `polymarket`

---

## Pre-configured Datasource

Prometheus is automatically configured as the default datasource via provisioning.

---

## Create Dashboard

### 1. Create New Dashboard

1. Click **+ → Dashboard → Add visualization**
2. Select **Prometheus** datasource

### 2. Recommended Panels

---

#### Panel 1: Arbitrage Spread (Gauge)

**Query:**

```promql
arb_spread_detected
```

**Settings:**

- Visualization: Gauge
- Min: 0, Max: 0.1
- Thresholds: 0.02 (green), 0.05 (yellow), 0.08 (red)

---

#### Panel 2: Simulated Profit (Counter)

**Query:**

```promql
rate(simulated_profit_total[5m]) * 300
```

**Settings:**

- Visualization: Stat
- Unit: USD
- Title: "Simulated Profit (5m)"

---

#### Panel 3: Gas Price (Time Series)

**Query:**

```promql
gas_price_current{type="max_fee"}
```

**Settings:**

- Visualization: Time series
- Unit: gwei
- Title: "Gas Price"

---

#### Panel 4: Execution Latency (Histogram)

**Query:**

```promql
histogram_quantile(0.95, rate(execution_latency_ms_bucket[5m]))
```

**Settings:**

- Visualization: Time series
- Unit: ms
- Title: "P95 Execution Latency"

---

#### Panel 5: Circuit Breaker Status (Stat)

**Query:**

```promql
circuit_breaker_state
```

**Settings:**

- Visualization: Stat
- Value mappings: 0=CLOSED (green), 1=OPEN (red), 2=HALF-OPEN (yellow)

---

#### Panel 6: Executions Rate (Time Series)

**Query:**

```promql
rate(executions_total[1m]) * 60
```

**Settings:**

- Visualization: Time series
- Unit: ops/min
- Legend: {{mode}} - {{status}}

---

## Alerting (Optional)

### Circuit Breaker Alert

```yaml
alert: CircuitBreakerOpen
expr: circuit_breaker_state == 1
for: 1m
labels:
  severity: critical
annotations:
  summary: "Circuit breaker is OPEN"
```

### Low Balance Alert

```yaml
alert: LowBalance
expr: rate(execution_errors_total{error_type="insufficient_balance"}[5m]) > 0
for: 1m
labels:
  severity: warning
```

---

## Import Dashboard JSON

You can also import dashboards via JSON. Save the dashboard and export as JSON for version control.

---

## Useful PromQL Queries

| Metric               | Query                            |
| -------------------- | -------------------------------- |
| Total paper trades   | `executions_total{mode="paper"}` |
| Total errors         | `execution_errors_total`         |
| Order book staleness | `orderbook_stale`                |
| Nonce pending        | Data from NonceManager logs      |
