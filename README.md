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

## 3. Copy UMLS RRF Files

Place your downloaded **MRCONSO.RRF** and **MRSTY.RRF** into the **same directory** as `load.js` (i.e. `umls-helper/umls-search/`):

```bash
# from wherever you downloaded the files:
cp /path/to/MRCONSO.RRF /path/to/umls-helper/umls-search/
cp /path/to/MRSTY.RRF  /path/to/umls-helper/umls-search/
```

## 4. Run ElasticSearch

Usually something like: 

```bash
ELASTICSEARCH_DIRECTORY/bin/elasticsearch
```

## 5. Create index and load data

```bash
node elastic-index.js
node --max-old-space-size=8192 load.js
```
load.js takes a few minutes. It's loading MRCONSO.RRF and MRSTY.RRF. 

## 6. Run a server

```bash
serve
```

## 7. Search

Open [localhost:3000/search.html](http://localhost:3000/search?) in a web browser and search.
