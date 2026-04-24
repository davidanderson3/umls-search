const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Client } = require('@elastic/elasticsearch');
const { ES_INDEX, ES_URL } = require('./elastic-config');
const es = new Client({
  node: ES_URL,
  requestTimeout: parseInt(process.env.ES_REQUEST_TIMEOUT_MS || '120000', 10),
  maxRetries: parseInt(process.env.ES_MAX_RETRIES || '3', 10),
});

const ensureSynonymAnalyzer = require('./elastic-index'); // ✅ Import index creation script
const { buildRelatedConceptsForSource } = require('./related-concepts');

const BATCH_SIZE = 500;

function getArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

const RRF_DIR =
  getArgValue('--rrf-dir') ||
  process.env.UMLS_RRF_DIR ||
  process.env.UMLS_RRF_PATH ||
  null;

const MRCONSO =
  getArgValue('--mrconso') ||
  process.env.MRCONSO_PATH ||
  (RRF_DIR ? path.join(RRF_DIR, 'MRCONSO.RRF') : 'MRCONSO.RRF');

const MRSTY =
  getArgValue('--mrsty') ||
  process.env.MRSTY_PATH ||
  (RRF_DIR ? path.join(RRF_DIR, 'MRSTY.RRF') : 'MRSTY.RRF');

const MRRANK =
  getArgValue('--mrrank') ||
  process.env.MRRANK_PATH ||
  (RRF_DIR ? path.join(RRF_DIR, 'MRRANK.RRF') : 'MRRANK.RRF');

const MRDEF =
  getArgValue('--mrdef') ||
  process.env.MRDEF_PATH ||
  (RRF_DIR ? path.join(RRF_DIR, 'MRDEF.RRF') : 'MRDEF.RRF');

const MRREL =
  getArgValue('--mrrel') ||
  process.env.MRREL_PATH ||
  (RRF_DIR ? path.join(RRF_DIR, 'MRREL.RRF') : 'MRREL.RRF');

const MRSAB =
  getArgValue('--mrsab') ||
  process.env.MRSAB_PATH ||
  (RRF_DIR ? path.join(RRF_DIR, 'MRSAB.RRF') : 'MRSAB.RRF');

function assertReadableFile(label, filePath) {
  if (!fs.existsSync(filePath)) {
    const resolvedPath = path.resolve(filePath);
    throw new Error(
      [
        `Missing required UMLS file: ${label}`,
        `Resolved path: ${resolvedPath}`,
        'Provide file locations with one of:',
        '  node --max-old-space-size=8192 load.js --rrf-dir /path/to/UMLS/META',
        '  export UMLS_RRF_DIR=/path/to/UMLS/META',
        `  export ${label}_PATH=/path/to/${label}.RRF`
      ].join('\n')
    );
  }
}

function validateInputFiles() {
  assertReadableFile('MRCONSO', MRCONSO);
  assertReadableFile('MRSTY', MRSTY);
  assertReadableFile('MRRANK', MRRANK);
  assertReadableFile('MRDEF', MRDEF);
}

function loadPreferredConceptNames(path) {
  return new Promise((resolve) => {
    const map = new Map();
    const rl = readline.createInterface({ input: fs.createReadStream(path) });

    rl.on('line', (line) => {
      const cols = line.split('|');
      const [CUI, LAT, TS, , , , ISPREF, , , , , SAB, , CODE, STR] = cols;
      const SUPPRESS = cols[16];
      if (LAT !== 'ENG' || SUPPRESS !== 'N') return;
      if (TS !== 'P' || ISPREF !== 'Y') return;
      if (!map.has(CUI)) map.set(CUI, STR);
    });

    rl.on('close', () => {
      console.log(`✅ Loaded preferred names for ${map.size.toLocaleString()} CUIs`);
      resolve(map);
    });
  });
}

function loadMRRank(path) {
  return new Promise((resolve) => {
    const map = new Map();
    const rl = readline.createInterface({ input: fs.createReadStream(path) });

    rl.on('line', (line) => {
      const [SAB, TTY, , , RANK] = line.split('|');
      map.set(`${SAB}|${TTY}`, parseInt(RANK, 10));
    });

    rl.on('close', () => resolve(map));
  });
}

function loadEnglishSABs(path) {
  if (!path || !fs.existsSync(path)) {
    console.warn('Skipping SAB language filter for MRREL: MRSAB.RRF not found');
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const englishSABs = new Set();
    const rl = readline.createInterface({ input: fs.createReadStream(path) });

    rl.on('line', (line) => {
      const cols = line.split('|');
      const RSAB = cols[3];
      const LAT = cols[19];
      if (LAT === 'ENG' && RSAB) {
        englishSABs.add(RSAB);
      }
    });

    rl.on('close', () => {
      console.log(`✅ Loaded ${englishSABs.size.toLocaleString()} English SABs from MRSAB`);
      resolve(englishSABs);
    });

    rl.on('error', () => {
      console.warn('Skipping SAB language filter for MRREL: failed to read MRSAB.RRF');
      resolve(null);
    });
  });
}

function createGroupedValueReader(filePath, parseLine, buildValue) {
  const rl = readline.createInterface({ input: fs.createReadStream(filePath) });
  const iterator = rl[Symbol.asyncIterator]();
  let bufferedEntry = null;
  let currentGroup = null;
  let exhausted = false;

  async function nextEntry() {
    while (true) {
      if (bufferedEntry) {
        const entry = bufferedEntry;
        bufferedEntry = null;
        return entry;
      }

      const { value, done } = await iterator.next();
      if (done) {
        exhausted = true;
        return null;
      }

      const entry = parseLine(value);
      if (entry) {
        return entry;
      }
    }
  }

  async function readNextGroup() {
    const first = await nextEntry();
    if (!first) return null;

    const rows = [first.value];
    const key = first.key;

    while (true) {
      const entry = await nextEntry();
      if (!entry) {
        return { key, value: buildValue(key, rows) };
      }
      if (entry.key !== key) {
        bufferedEntry = entry;
        return { key, value: buildValue(key, rows) };
      }
      rows.push(entry.value);
    }
  }

  return {
    async get(targetKey) {
      if (!targetKey) return null;
      if (!currentGroup && exhausted) return null;
      if (!currentGroup) {
        currentGroup = await readNextGroup();
      }

      while (currentGroup && currentGroup.key < targetKey) {
        currentGroup = await readNextGroup();
      }

      if (currentGroup && currentGroup.key === targetKey) {
        const value = currentGroup.value;
        currentGroup = await readNextGroup();
        return value;
      }

      return null;
    },
    async close() {
      exhausted = true;
      rl.close();
      if (typeof iterator.return === 'function') {
        try {
          await iterator.return();
        } catch (err) {
          // Ignore close-time iterator errors.
        }
      }
    }
  };
}

function createSemanticTypeReader(filePath) {
  return createGroupedValueReader(
    filePath,
    (line) => {
      const [CUI, , , STY] = line.split('|');
      if (!CUI || !STY) return null;
      return { key: CUI, value: STY };
    },
    (_cui, rows) => Array.from(new Set(rows))
  );
}

function createDefinitionReader(filePath, preferredNameMap) {
  return createGroupedValueReader(
    filePath,
    (line) => {
      const cols = line.split('|');
      const CUI = cols[0];
      const DEF = cols[5];
      if (!CUI || !preferredNameMap.has(CUI) || !DEF) return null;

      // Attach definitions only to concepts that have an English, non-suppressed term.
      const cleaned = DEF.trim().replace(/\s+/g, ' ');
      if (!cleaned) return null;
      return { key: CUI, value: cleaned };
    },
    (_cui, rows) => Array.from(new Set(rows))
  );
}

function createRelatedConceptReader(filePath, preferredNameMap, englishSABs) {
  if (!filePath || !fs.existsSync(filePath)) {
    console.warn('Skipping MRREL enrichment: file not found');
    return {
      async get() {
        return null;
      },
      async close() {}
    };
  }

  return createGroupedValueReader(
    filePath,
    (line) => {
      const cols = line.split('|');
      const sourceCui = cols[0];
      const targetCui = cols[4];
      const sab = cols[10];
      const SUPPRESS = cols[14];

      if (!sourceCui || !targetCui || sourceCui === targetCui) return null;
      if (SUPPRESS && SUPPRESS !== 'N') return null;
      if (englishSABs && (!sab || !englishSABs.has(sab))) return null;

      return {
        key: sourceCui,
        value: {
          targetCui,
          stype1: cols[2],
          rel: cols[3],
          stype2: cols[6],
          rela: cols[7],
          sab
        }
      };
    },
    (sourceCui, rows) => buildRelatedConceptsForSource(sourceCui, rows, preferredNameMap)
  );
}

async function run() {
  validateInputFiles();

  try {
    await es.indices.delete({ index: ES_INDEX });
    console.log(`🗑️ Deleted existing index: ${ES_INDEX}`);
  } catch (err) {
    if (err.meta?.statusCode === 404) {
      console.log(`ℹ️ Index does not exist yet: ${ES_INDEX}`);
    } else {
      throw err;
    }
  }

  await ensureSynonymAnalyzer(); // ✅ Recreate index with mappings and synonym analyzer
  await es.indices.putSettings({
    index: ES_INDEX,
    body: { index: { refresh_interval: '-1' } }
  });
  console.log('⚡ Disabled refresh_interval for bulk load');

  const preferredNameMap = await loadPreferredConceptNames(MRCONSO);
  const mrRankMap = await loadMRRank(MRRANK);
  const englishSABs = await loadEnglishSABs(MRSAB);
  console.log('⚡ Streaming semantic types, definitions, and related concepts by CUI');
  const styReader = createSemanticTypeReader(MRSTY);
  const definitionReader = createDefinitionReader(MRDEF, preferredNameMap);
  const relatedConceptReader = createRelatedConceptReader(MRREL, preferredNameMap, englishSABs);
  const rl = readline.createInterface({ input: fs.createReadStream(MRCONSO) });

  let currentCUI = null, doc = null, codesMap = null;
  let count = 0;
  let definitionCount = 0;
  let relatedConceptCount = 0;
  const bulkOps = [];

  function setPreferredNamesForCodes(codesMap) {
    for (const code of codesMap.values()) {
      if (code._ranked.length > 0) {
        code._ranked.sort((a, b) => a.rank - b.rank);
        code.preferred_name = code._ranked[0].STR;
      } else if (code.strings.length > 0) {
        code.preferred_name = code.strings[0];
      } else {
        code.preferred_name = null;
      }
      delete code._ranked;
    }
  }

  const flush = async (finalFlush = false) => {
    if (!doc) return;
    setPreferredNamesForCodes(codesMap);
    doc.codes = Array.from(codesMap.values());
    doc.atom_text = [
      doc.preferred_name,
      ...doc.codes.flatMap(code => code.strings || [])
    ].filter(Boolean).join(' ');
    const relatedConcepts = await relatedConceptReader.get(doc.CUI);
    if (Array.isArray(relatedConcepts) && relatedConcepts.length > 0) {
      doc.related_concepts = relatedConcepts;
      relatedConceptCount++;
    }
    bulkOps.push({ index: { _index: ES_INDEX, _id: doc.CUI } });
    bulkOps.push(doc);
    count++;
    if (bulkOps.length >= BATCH_SIZE * 2 || finalFlush) {
      await es.bulk({ body: bulkOps });
      bulkOps.length = 0;
      console.log(`📤 Indexed ${count.toLocaleString()} CUIs`);
    }
    doc = null;
    codesMap = null;
  };

  try {
    for await (const line of rl) {
      const cols = line.split('|');
      const [CUI, LAT, TS, , , , ISPREF, , , , , SAB, TTY, CODE, STR] = cols;
      const SUPPRESS = cols[16];
      if (LAT !== 'ENG' || SUPPRESS !== 'N') continue;

      if (CUI !== currentCUI) {
        await flush();
        currentCUI = CUI;

        const semanticTypes = await styReader.get(CUI);
        const defs = await definitionReader.get(CUI);

        doc = {
          CUI,
          preferred_name: null,
          STY: semanticTypes || [],
          codes: []
        };

        if (Array.isArray(defs) && defs.length > 0) {
          doc.definitions = defs;
          definitionCount++;
        }

        codesMap = new Map();
      }

      if (!doc.preferred_name && TS === 'P' && ISPREF === 'Y') {
        doc.preferred_name = STR;
      }

      const key = `${SAB}|${CODE}`;
      if (!codesMap.has(key)) {
        codesMap.set(key, {
          SAB,
          CODE,
          preferred_name: null,
          strings: [],
          _ranked: []
        });
      }
      const codeObj = codesMap.get(key);
      codeObj.strings.push(STR);
      const rank = mrRankMap.get(`${SAB}|${TTY}`) ?? 9999;
      codeObj._ranked.push({ STR, rank });
    }

    await flush(true);
  } finally {
    rl.close();
    await Promise.allSettled([
      styReader.close(),
      definitionReader.close(),
      relatedConceptReader.close()
    ]);
  }
  console.log(`✅ Finished indexing ${count.toLocaleString()} CUIs`);
  console.log(`✅ Streamed definitions for ${definitionCount.toLocaleString()} CUIs`);
  console.log(`✅ Streamed related concepts for ${relatedConceptCount.toLocaleString()} CUIs`);

  await es.indices.putSettings({
    index: ES_INDEX,
    body: { index: { refresh_interval: '1s' } }
  });
  console.log('✅ Restored refresh_interval to 1s');

  console.log('🔧 Forcemerging index to 1 segment...');
  await es.indices.forcemerge({ index: ES_INDEX, max_num_segments: 1 });
  console.log('✅ Forcemerge complete');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
