const fs = require('fs');
const readline = require('readline');
const { Client } = require('@elastic/elasticsearch');
const es = new Client({ node: 'http://127.0.0.1:9200' });

const BATCH_SIZE = 500;
const MRCONSO = 'MRCONSO.RRF';
const MRSTY = 'MRSTY.RRF';

function loadPreferredCodeNames(path) {
  return new Promise((resolve) => {
    const map = new Map();
    const rl = readline.createInterface({ input: fs.createReadStream(path) });

    rl.on('line', (line) => {
      const cols = line.split('|');
      const [CUI, LAT, TS, LUI, STT, SUI, ISPREF, AUI, SAUI, SCUI, SDUI, SAB, TTY, CODE, STR] = cols;
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
    const map = new Map();
    const validCUIs = new Set();

    // Step 1: Load valid CUIs with `LAT === 'ENG'` from MRCONSO.RRF
    const rlConso = readline.createInterface({ input: fs.createReadStream(consoPath) });
    rlConso.on('line', (line) => {
      const cols = line.split('|');
      const CUI = cols[0];
      const LAT = cols[1];
      const SUPPRESS = cols[16];
      if (LAT === 'ENG' && SUPPRESS === 'N') {
        validCUIs.add(CUI);
      }
    });

    rlConso.on('close', () => {
      console.log(`✅ Loaded ${validCUIs.size.toLocaleString()} CUIs with LAT === 'ENG'`);

      // Step 2: Load definitions from MRDEF.RRF for valid CUIs
      const rlDef = readline.createInterface({ input: fs.createReadStream(defPath) });
      rlDef.on('line', (line) => {
        const cols = line.split('|');
        const CUI = cols[0];
        const DEF = cols[5];
        if (!validCUIs.has(CUI)) return; // Skip non-English CUIs
        if (!map.has(CUI)) map.set(CUI, []);
        map.get(CUI).push(DEF);
      });

      rlDef.on('close', () => {
        console.log(`✅ Loaded definitions for ${map.size.toLocaleString()} CUIs`);
        resolve(map);
      });
    });
  });
}

async function run() {
  const codePrefMap = await loadPreferredCodeNames(MRCONSO);
  const styMap = await loadSTY(MRSTY);
  const mrRankMap = await loadMRRank('MRRANK.RRF');
  const defMap = await loadDefinitions('MRDEF.RRF', MRCONSO);
  const rl = readline.createInterface({ input: fs.createReadStream(MRCONSO) });

  let currentCUI = null, doc = null, codesMap = null;
  let count = 0;
  const bulkOps = [];

  // Helper to set code preferred_name using MRRANK
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

    // ⬇️ Add this line to flatten preferred name + all atom strings
    doc.atom_text = [
      doc.preferred_name,
      ...doc.codes.flatMap(code => code.strings || [])
    ].filter(Boolean).join(' ');

    bulkOps.push({ index: { _index: 'umls-cui', _id: doc.CUI } });
    bulkOps.push(doc);

    count++;

    if (bulkOps.length >= BATCH_SIZE * 2 || finalFlush) {
      await es.bulk({ body: bulkOps });
      bulkOps.length = 0;
      console.log(`📤 Indexed ${count.toLocaleString()} CUIs`);
    }

    // Always reset after flush
    doc = null;
    codesMap = null;
  };

  for await (const line of rl) {
    const cols = line.split('|');
    const [CUI, LAT, TS, , , , ISPREF, , , , , SAB, TTY, CODE, STR] = cols;
    const SUPPRESS = cols[16];
    if (LAT !== 'ENG' || SUPPRESS !== 'N') continue;

    if (CUI !== currentCUI) {
      await flush();  // Flush the previous CUI
      currentCUI = CUI;
      doc = {
        CUI,
        preferred_name: null,
        STY: styMap.get(CUI) || [],
        codes: [],
        definitions: defMap.get(CUI) || []
      };
      codesMap = new Map();
    }

    // Preserve CUI preferred_name logic
    if (!doc.preferred_name && TS === 'P' && ISPREF === 'Y') {
      doc.preferred_name = STR;
    }

    // Build codes map
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

    // Store for ranking
    const rank = mrRankMap.get(`${SAB}|${TTY}`) ?? 9999;
    codeObj._ranked.push({ STR, rank });
  }

  // Final flush after loop
  await flush(true);

  console.log(`✅ Finished indexing ${count.toLocaleString()} CUIs`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
