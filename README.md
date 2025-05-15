# UMLS Local Search 

These are really simple scripts to help you search the UMLS locally on your machine using ElasticSearch. 

## 1. Prerequisites  
Make sure you have the following installed and running:

1. **Node.js v18+ & npm**  
2. **Elasticsearch 8.x**
3. **UMLS data files**  
   - Get a UMLS license: [https://uts.nlm.nih.gov/uts/signup-login](https://uts.nlm.nih.gov/uts/signup-login).
   - Once approved, download UMLS Metathesaurus Full Subset from [https://www.nlm.nih.gov/research/umls/licensedcontent/umlsknowledgesources.html](https://www.nlm.nih.gov/research/umls/licensedcontent/umlsknowledgesources.html), which includes **MRCONSO.RRF** and **MRSTY.RRF**

---

## 2. Install Node Dependencies

```bash
cd umls-helper/umls-search    # enter the project subfolder
npm install                   # install @elastic/elasticsearch, etc
```

---

## 3. Copy UMLS RRF Files

Place your downloaded **MRCONSO.RRF** and **MRSTY.RRF** into the **same directory** as `load.js` (i.e. `umls-helper/umls-search/`):

```bash
# from wherever you downloaded the files:
cp /path/to/MRCONSO.RRF /path/to/umls-helper/umls-search/
cp /path/to/MRSTY.RRF  /path/to/umls-helper/umls-search/
```

---

## 4. Run ElasticSearch

Usually something like: 

```bash
ELASTICSEARCH_DIRECTORY/bin/elasticsearch
```

---

## 5. Create index and load data

```bash
node elastic-index.js
node --max-old-space-size=8192 load.js
```

load.js takes a few minutes. It's loading MRCONSO.RRF and MRSTY.RRF. 

---

## 6. Run the backend server

This serves both the frontend and API together:

```bash
node backend/server.js
```

---

## 7. Search

Use the web interface to search:
```
http://localhost:3000/
```

or query via API:
```
http://localhost:3000/api/search
```

---

## 8. API

### API Endpoint

**GET** `/api/search?q=search_term&page=page_number&size=page_size`

#### Parameters

| Parameter | Type   | Required | Description |
|----------|--------|----------|-------------|
| q        | string | Yes      | Search term to query |
| page     | int    | No       | Zero-based page index (default = 0) |
| size     | int    | No       | Page size (default = 100) |

#### Example Request

```bash
curl "http://localhost:3000/api/search?q=diabetes&page=0&size=100"
```

---

## 9. Ranking

The system uses a three-phase approach to rank search results:

### Phase 1: Exact Match Override (Backend)

Before running the full search, the backend checks for exact string matches:
- If `preferred_name` matches the query (case-insensitive), that result is returned first.
- If no match, it checks if any `codes[].strings[]` value matches the query (case-insensitive).
- These matches bypass normal scoring and are always returned at the top of the results list.

### Phase 2: Candidate Retrieval (Elasticsearch)

Elasticsearch retrieves additional candidate records using full-text search:
- Fields `preferred_name` and `codes[].strings[]` use a custom `synonym_analyzer` with:
  - Lowercasing
  - Synonym expansion (from `synonyms.json`)
  - Stop word removal
  - Stemming

### Phase 3: Custom Re-Ranking (Backend)

Remaining results from the full search are passed to a custom scoring routine in the backend:

1. **Combined match score**
- `combined score` = codes match count + (query word coverage ratio × coverage weight)
- `codes match count`: number of times the raw query appears as a substring in any `codes[].strings[]`. This is the dominant factor.
- `query word coverage ratio`: percentage of query words appearing in `preferred_name` or `codes[].strings[]`. This provides a smaller secondary boost.
- `coverage weight` is set low (e.g., 0.3) to avoid outweighing codes matches.

2. **Fallback**
- If all scores are identical, the original Elasticsearch order is preserved.
