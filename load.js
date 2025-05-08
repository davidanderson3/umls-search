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
      const [CUI,, , STY] = line.split('|');
      if (!map.has(CUI)) map.set(CUI, []);
      map.get(CUI).push(STY);
    });

    rl.on('close', () => resolve(map));
  });
}

async function run() {
  const codePrefMap = await loadPreferredCodeNames(MRCONSO);
  const styMap = await loadSTY(MRSTY);
  const rl = readline.createInterface({ input: fs.createReadStream(MRCONSO) });

  let currentCUI = null, doc = null, codesMap = null;
  let count = 0;
  const bulkOps = [];

  const flush = async (finalFlush = false) => {
    if (!doc) return;
  
    doc.codes = Array.from(codesMap.values());
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
    const [CUI, LAT, TS, , , , ISPREF, AUI, , SCUI, SDUI, SAB, TTY, CODE, STR] = cols;
    const SUPPRESS = cols[16];
    if (LAT !== 'ENG' || SUPPRESS !== 'N') continue;

    if (CUI !== currentCUI) {
      await flush();  // Flush the previous CUI
      currentCUI = CUI;
      doc = {
        CUI,
        preferred_name: null,
        STY: styMap.get(CUI) || [],
        codes: []
      };
      codesMap = new Map();
    }

    // Set preferred name for the CUI
    if (!doc.preferred_name && TS === 'P' && ISPREF === 'Y') {
      doc.preferred_name = STR;
    }

    const key = `${SAB}|${CODE}`;
    if (!codesMap.has(key)) {
      codesMap.set(key, {
        SAB,
        CODE,
        preferred_name: codePrefMap.get(key) || null,
        strings: []
      });
    }
    codesMap.get(key).strings.push(STR);
  }

  // ✅ Final flush to ensure last CUI is not missed
  await flush(true);

  console.log(`✅ Finished indexing ${count.toLocaleString()} CUIs`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
