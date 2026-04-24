# UMLS Local Search 

These are really simple scripts to help you search the UMLS locally on your machine using ElasticSearch. 

## 1. Prerequisites  
Make sure you have the following installed and running:

1. **Node.js v18+ & npm**  
2. **Elasticsearch 8.x** (tested on **8.19.5**)
3. **UMLS data files**  
   - Get a UMLS license: [https://uts.nlm.nih.gov/uts/signup-login](https://uts.nlm.nih.gov/uts/signup-login).
   - Once approved, download UMLS Metathesaurus Full Subset from [https://www.nlm.nih.gov/research/umls/licensedcontent/umlsknowledgesources.html](https://www.nlm.nih.gov/research/umls/licensedcontent/umlsknowledgesources.html), which includes **MRCONSO.RRF**, **MRSTY.RRF**, **MRRANK.RRF**, **MRDEF.RRF**, and **MRREL.RRF**

---

## 2. Install Node Dependencies

```bash
cd umls-search                # enter the project subfolder
npm install                   # install @elastic/elasticsearch, etc
```

---

## 3. Point to UMLS RRF Files

Keep the UMLS RRF files wherever they live and pass their locations to `load.js`.

### Option A: Point to a directory

```bash
export UMLS_RRF_DIR=/path/to/umls/2024AB/META
node --max-old-space-size=8192 load.js --rrf-dir /path/to/umls/2025AB/META
```

### Option B: Point to each file explicitly

```bash
export MRCONSO_PATH=/path/to/umls/2024AB/META/MRCONSO.RRF
export MRSTY_PATH=/path/to/umls/2024AB/META/MRSTY.RRF
export MRRANK_PATH=/path/to/umls/2024AB/META/MRRANK.RRF
export MRDEF_PATH=/path/to/umls/2024AB/META/MRDEF.RRF
export MRREL_PATH=/path/to/umls/2024AB/META/MRREL.RRF
node --max-old-space-size=8192 load.js
```

You can also pass paths via CLI flags:

```bash
node --max-old-space-size=8192 load.js \
  --rrf-dir /path/to/umls/2024AB/META
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
node --max-old-space-size=8192 load.js --rrf-dir /path/to/umls/2025AB/META
```

By default these scripts create and load the `umls-cui` index. To target a different index name:

```bash
ES_INDEX=my-umls-index node elastic-index.js
ES_INDEX=my-umls-index node --max-old-space-size=8192 load.js --rrf-dir /path/to/umls/2025AB/META
```

load.js takes a few minutes. It's loading MRCONSO.RRF (Concepts, Names, Codes), MRSTY.RRF (Semantic Types), MRDEF.RRF (Definitions), and MRREL.RRF (related concept assertions).

MRREL enrichment adds a `related_concepts` annotation per CUI. The score favors:

- trusted source vocabularies (`SAB`)
- specific asserted relationships (`RELA`) over broad `REL` buckets
- repeated support from different source families
- modest extra support for additional `SAB`s and repeated rows within the same family

At query time, relation-tail candidates are seeded from a narrow lexical source set. The backend first
prefers the strongest exact concept hit (especially `preferred_name` and `CUI` exact matches), then falls
back to one alternate exact concept if needed, and finally to a small lexical fallback only when exact-seeded
relation expansion produces no candidates. Relation-tail candidates sourced from exact lexical matches receive
an additional multiplier (`RELATED_EXACT_SOURCE_MULTIPLIER`, default `1.35`) before they are ranked against
relation candidates seeded from non-exact lexical hits.

---

## 6. Run the backend server

This serves both the frontend and API together:

```bash
node backend/server.js
```

If your Elasticsearch data already exists under a different index or alias, point the backend at it:

```bash
ES_INDEX=uts_release_2025ab node backend/server.js
```

If port `3000` is already in use, run it on another port:

```bash
PORT=3001 node backend/server.js
```

---

## 7. Search

Use the web interface to search:
```
http://localhost:3000/
```

If you started the server with `PORT=3001`, use:
```
http://localhost:3001/
```

or query via API, for example:
```
http://localhost:3000/api/search?q=renal%20tubular%20acidosis&page=1&size=100&fuzzy=true
```

Or on a different port:
```
http://localhost:3001/api/search?q=renal%20tubular%20acidosis&page=1&size=100&fuzzy=true
```

---

## 8. API

### API Endpoint

**GET** `/api/search?q=search_term&page=page_number&size=page_size&fuzzy=true|false&include_definitions=true|false&related_only=true|false`

#### Parameters

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `q`       | string | Yes      | Search term to query |
| `page`    | int    | No       | One-based page index (default = 1) |
| `size`    | int    | No       | Page size (default = 100) |
| `fuzzy`   | bool   | No       | If `true`, enables fuzzy matching (default = `false`) |
| `include_definitions` | bool | No | If `false`, removes definition clauses from lexical retrieval so only name/synonym matches are used (default = `true`) |
| `related_only` | bool | No    | If `true`, returns only relation-derived hits from the relation tail (default = `false`) |

#### Example Request

```bash
curl "http://localhost:3000/api/search?q=diabetes&page=1&size=100&fuzzy=true&include_definitions=false"
```

If needed, replace `3000` with the port you started the server on.

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

- `match_phrase` on `atom_text.no_synonyms` (highest boost)
- `match` with `operator: "and"` on `atom_text.no_synonyms`
- `match_phrase` on synonym-expanded `atom_text`
- `match` with `operator: "and"` on synonym-expanded `atom_text`
- *(Optional)* `match` with `fuzziness` on `atom_text` — only if `fuzzy=true`
- `match_phrase` and `match` on `definitions` (lower boost) 

The backend then:

- Filters out any CUIs already returned by exact match
- Assigns `_customScore = _score` from Elasticsearch
- Tags non-exact lexical hits with `"matchType": "full-text"` unless they matched the fuzzy clause, in which case they are labeled `"matchType": "fuzzy"`
- Optionally appends a small number of relation-derived hits from `related_concepts`
- Seeds relation-derived candidates from a narrow set of high-confidence lexical hits, preferring the strongest exact concept hit before broader fallback hits
- Forces relation-derived hits to the tail of the ranking with a negative custom score
- Combines results, deduplicates by CUI, and sorts:
  1. Exact matches (`_customScore = Infinity`) first
  2. Full-text and fuzzy matches, descending by `_customScore`
  3. Relation-derived matches at the end
  4. Tie-breaker: alphabetical by CUI
