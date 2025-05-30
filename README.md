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
cd umls-search                # enter the project subfolder
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

load.js takes a few minutes. It's loading MRCONSO.RRF (Concepts, Names, Codes), MRSTY.RRF (Semantic Types), and MRDEF.RRF (Definitions). 

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

or query via API, for example:
```
http://localhost:3000/api/search?q=renal%20tubular%20acidosis&page=1&size=100&fuzzy=true
```

---

## 8. API

### API Endpoint

**GET** `/api/search?q=search_term&page=page_number&size=page_size&fuzzy=true|false`

#### Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `q`       | string | Yes      | Search term to query |
| `page`    | int    | No       | One-based page index (default = 1) |
| `size`    | int    | No       | Page size (default = 100) |
| `fuzzy`   | bool   | No       | If `true`, enables fuzzy matching (default = `false`) |

#### Example Request

```bash
curl "http://localhost:3000/api/search?q=diabetes&page=1&size=100&fuzzy=true"
```

---

## 9. Ranking

The system uses a two-phase approach to rank and return UMLS concept search results:

### Phase 1: Exact Match Override (Backend)

Before running the main search, the backend checks for **exact string matches** against lowercase-normalized fields:

- `preferred_name.lowercase_keyword`
- `CUI.lowercase_keyword`
- `codes[].CODE.lowercase_keyword`
- `codes[].strings[].lowercase_keyword`

If the query matches one of these fields **exactly**, those results:

- Are included at the **top of the result list**
- Are labeled with `"matchType": "exact"`
- Are assigned a `_customScore` of `Infinity` to force top placement

### Phase 2: Candidate Retrieval + Sorting (Elasticsearch)

The backend performs a full-text search using Elasticsearch across the following fields:

- `atom_text` (concatenated synonyms and name strings)
- `definitions`

The query combines:

- `match_phrase` on `atom_text` (high boost)
- `match` with `operator: "and"` on `atom_text`
- *(Optional)* `match` with `fuzziness` on `atom_text` — only if `fuzzy=true`
- `match` on `definitions` (lower boost) 

The backend then:

- Filters out any CUIs already returned by exact match
- Assigns `_customScore = _score` from Elasticsearch
- Tags each hit with `"matchType": "fuzzy"`
- Combines results, deduplicates by CUI, and sorts:
  1. Exact matches (`_customScore = Infinity`) first
  2. Fuzzy matches, descending by `_customScore`
  3. Tie-breaker: alphabetical by CUI
