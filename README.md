# UMLS Local Search 

These are really simple scripts to help you search the UMLS locally on your machine using ElasticSearch. 

## 1. Prerequisites  
Make sure you have the following installed and running:

1. **Node.js v18+ & npm**  
2. **Elasticsearch 8.x**
3. **UMLS data files**  
   - Get a UMLS license: [https://uts.nlm.nih.gov/uts/signup-login](https://uts.nlm.nih.gov/uts/signup-login).
   - Once approved, download UMLS Metathesaurus Full Subset from [https://www.nlm.nih.gov/research/umls/licensedcontent/umlsknowledgesources.html](https://www.nlm.nih.gov/research/umls/licensedcontent/umlsknowledgesources.html), which includes **MRCONSO.RRF**, **MRSTY.RRF**, and **MRRANK.RRF**

---

## 2. Install Node Dependencies

```bash
cd umls-helper/umls-search    # enter the project subfolder
npm install                   # install @elastic/elasticsearch, etc
```

---

## 3. Copy UMLS RRF Files

Place your downloaded **MRCONSO.RRF**, **MRSTY.RRF**, and **MRRANK.RRF** into the **same directory** as `load.js` (i.e. `umls-helper/umls-search/`):

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

The system uses a two-phase approach to rank and return UMLS concept search results:

### Phase 1: Exact Match Override (Backend)

Before running the main search, the backend checks for exact string matches against lowercase-normalized fields:

- If the query exactly matches `preferred_name`, `CUI`, or any `codes[].CODE` or `codes[].strings[]`, those results are marked as **exact matches**.
- These matches are assigned a `_customScore` of `Infinity` and **always appear first**, regardless of Elasticsearch scoring.

### Phase 2: Candidate Retrieval + Re-Ranking (Elasticsearch + Backend)

The system then performs a full-text search using Elasticsearch:

- **Only the `atom_text` and `definitions` fields** are queried.
- The query uses a mix of:
  - `match_phrase` on `atom_text` (high boost)
  - `match` with `operator: "and"` on `atom_text`
  - `match` with fuzziness on `atom_text`
  - `match` on `definitions` (lower boost)

After retrieval:
- Each hit is re-scored in the backend using **query stem coverage**:
  - The query is tokenized and stemmed.
  - The system computes the ratio of query stems that appear in the `atom_text` field of the result.
  - This ratio becomes the `_customScore` for ranking.

- Results are sorted descending by `_customScore`.

