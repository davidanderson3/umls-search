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

function loadPreferredCodeNames(path) {
  return new Promise((resolve) => {
    const map = new Map();
    const rl = readline.createInterface({ input: fs.createReadStream(path) });

    rl.on('line', (line) => {
      const cols = line.split('|');
      const [CUI, LAT, TS, , , , ISPREF, , , , , SAB, , CODE, STR] = cols;
      const SUPPRESS = cols[16];
      if (LAT !== 'ENG' || SUPPRESS !== 'N') return;
      if (TS !== 'P' || ISPREF !== 'Y') return;
      const key = `${SAB}|${CODE}`;
      if (!map.has(key)) map.set(key, STR);
    });

    rl.on('close', () => {
      console.log(`✅ Loaded preferred names for ${map.size.toLocaleString()} CODEs`);
      resolve(map);
    });
  });
}

function loadSTY(path) {
  return new Promise((resolve) => {
    const map = new Map();
    const rl = readline.createInterface({ input: fs.createReadStream(path) });

    rl.on('line', (line) => {
      const [CUI, , , STY] = line.split('|');
      if (!map.has(CUI)) map.set(CUI, []);
      map.get(CUI).push(STY);
    });

    rl.on('close', () => resolve(map));
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

async function loadDefinitions(defPath, consoPath) {
  return new Promise((resolve) => {
    const validAUIs = new Set();

    // First pass: collect valid English, non-suppressed AUIs from MRCONSO
    const rlConso = readline.createInterface({ input: fs.createReadStream(consoPath) });
    rlConso.on('line', (line) => {
      const cols = line.split('|');
      const AUI = cols[7];  // 8th field
      const LAT = cols[1];  // 2nd field
      const SUPPRESS = cols[16]; // 17th field
      if (LAT === 'ENG' && SUPPRESS === 'N') {
        validAUIs.add(AUI);
      }
    });

    rlConso.on('close', () => {
      console.log(`✅ Found ${validAUIs.size.toLocaleString()} English, non-suppressed AUIs`);

      const map = new Map(); // CUI -> Set of definitions
      const rlDef = readline.createInterface({ input: fs.createReadStream(defPath) });

      rlDef.on('line', (line) => {
        const cols = line.split('|');
        const CUI = cols[0];   // 1st field
        const AUI = cols[1];   // 2nd field
        const DEF = cols[5];   // 6th field

        if (!validAUIs.has(AUI)) return;

        const cleaned = DEF.trim().replace(/\s+/g, ' ');
        if (!map.has(CUI)) map.set(CUI, new Set());
        map.get(CUI).add(cleaned);
      });

      rlDef.on('close', () => {
        const finalMap = new Map();
        for (const [cui, defSet] of map.entries()) {
          finalMap.set(cui, [...defSet]);
        }
        console.log(`✅ Loaded definitions for ${finalMap.size.toLocaleString()} CUIs`);
        resolve(finalMap);
      });
    });

    rlConso.on('error', (err) => console.error('Error reading MRCONSO:', err));
  });
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

  const codePrefMap = await loadPreferredCodeNames(MRCONSO);
  const styMap = await loadSTY(MRSTY);
  const mrRankMap = await loadMRRank(MRRANK);
  const defMap = await loadDefinitions(MRDEF, MRCONSO);
  const rl = readline.createInterface({ input: fs.createReadStream(MRCONSO) });

  let currentCUI = null, doc = null, codesMap = null;
  let count = 0;
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

  for await (const line of rl) {
    const cols = line.split('|');
    const [CUI, LAT, TS, , , , ISPREF, , , , , SAB, TTY, CODE, STR] = cols;
    const SUPPRESS = cols[16];
    if (LAT !== 'ENG' || SUPPRESS !== 'N') continue;

    if (CUI !== currentCUI) {
      await flush();
      currentCUI = CUI;

      const defs = defMap.get(CUI);

      doc = {
        CUI,
        preferred_name: null,
        STY: styMap.get(CUI) || [],
        codes: []
      };

      if (Array.isArray(defs) && defs.length > 0) {
        doc.definitions = defs;
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
  console.log(`✅ Finished indexing ${count.toLocaleString()} CUIs`);

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
