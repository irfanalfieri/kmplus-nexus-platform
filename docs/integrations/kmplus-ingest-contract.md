# Nexus Ingest Contract v1 (for KMPlus products)

How KMS, LMS, TMS, PMS, CMS and IMS receive data from KMPlus Nexus. A product that implements these four endpoints becomes a destination in Nexus: in a pipeline, choose the product's data source and an entity, and Nexus pushes the records at every run.

Records use the **Unified Data Model** field names (see `lib/domain/model.ts` and PRD §8): `employee_code`, `full_name`, `email`, `org_code`, `position_code`, `manager_code`, `hire_date` …

## Authentication

Nexus sends `Authorization: Bearer <token>`. The product issues the token (one per customer workspace) and the workspace admin enters it in Nexus (Data Sources → Add Destination → KMPlus Products). Reject unknown tokens with `401`.

Nexus calls the product from its servers (Tokyo region). The base URL must be public `https://`.

## Endpoints

All paths are under `{baseUrl}/nexus/v1`. Requests and responses are JSON.

### `GET /health`
```json
{ "product": "LMS", "version": "4.2.0" }
```

### `GET /entities`
Which entities the product accepts, its natural key, and the fields it stores. Nexus shows these as the "tables" of the destination and checks pipeline output against them.
```json
{
  "entities": [
    {
      "name": "employee",
      "key": "employee_code",
      "fields": [
        { "name": "employee_code", "type": "text", "required": true },
        { "name": "full_name", "type": "text" },
        { "name": "email", "type": "text", "required": true },
        { "name": "org_code", "type": "text" },
        { "name": "hire_date", "type": "date" }
      ]
    }
  ]
}
```
Types: `text`, `integer`, `numeric`, `boolean`, `date` (YYYY-MM-DD), `timestamp` (ISO 8601), `json`.

### `POST /entities/{entity}/upsert`
```json
{
  "batch_id": "run_9ff9…:3:0",
  "run_id": "run_9ff9…",
  "records": [
    { "employee_code": "E0001", "full_name": "Ana Putri", "email": "ana@customer.co.id", "org_code": "FIN", "hire_date": "2024-01-15" }
  ]
}
```
- Insert or update each record **by the entity key**. Fields that aren't sent stay unchanged.
- Up to 500 records per call.
- `batch_id` is stable for a given run, chunk and position. If Nexus retries after a timeout, the same batch arrives again. Upserting by key makes that harmless; products can also skip batch ids they already applied.
- Respond `200`:
```json
{ "accepted": 499, "rejected": [{ "index": 12, "error": "email is required" }] }
```
  - `index` is the record's position in this batch.
  - Rejected records go to the Nexus **Data Quality** inbox, where a steward can fix them and replay them to the product.
- Error codes:
  - `401` / `403`: bad token. Nexus stops the run and doesn't retry.
  - `429` / `5xx`: Nexus retries the run from its last checkpoint.
  - Any other `4xx`: the run fails with the response text.

### `GET /entities/{entity}?limit=25` (optional)
A few stored records, shown as the "sample" in Nexus. Return `{ "records": [...] }`, or `404` if not supported.

## Behaviour to expect from Nexus

- **Ordering:** batches of one run arrive in order, one at a time. Different runs of the same pipeline never overlap.
- **Deletes:** v1 sends no deletes. Employees who leave keep their record. Send `employment_status` / `termination_date` and handle departures from those fields. A `POST /entities/{entity}/deactivate` endpoint is planned for v2.
- **Volume:** one run can send up to 1,000,000 records, in 5,000-row chunks of 500-record batches. Answer within 30 seconds per batch.
- **Testing:** `scripts/test/kmplus-mock.ts` is a reference implementation of this contract (about 60 lines) and is used in Nexus's own tests.

## Pulling instead of receiving

Products that would rather pull can read the same entities from the Data API, `GET /api/v1/domains/employee` (cursor paging, `updated_since`), and subscribe to the `dataset.updated` webhook to know when to pull. See `/api/v1/openapi.json`.
