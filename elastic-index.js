// elastic-index.js
const { Client } = require('@elastic/elasticsearch');
const SYNONYMS = require('./synonyms.json');

const INDEX = 'umls-cui';
const es = new Client({
  node: 'http://127.0.0.1:9200',
  compatibility: { version: 8 }  // talk v8 headers to the 8.x cluster
});

async function ensureSynonymAnalyzer() {
  // shared analyzer settings
  const settingsBody = {
    analysis: {
      filter: {
        custom_synonym_filter: {
          type:     'synonym_graph',
          synonyms: SYNONYMS
        }
      },
      analyzer: {
        default:          { type: 'english' },
        synonym_analyzer: {
          tokenizer: 'standard',
          filter:    ['lowercase', 'custom_synonym_filter']
        }
      }
    }
  };

  // 1) Check existence
  const exists = await es.indices.exists({ index: INDEX });

  if (!exists) {
    // 2a) Create index with mappings + analyzers
    await es.indices.create({
      index: INDEX,
      body: {
        settings: settingsBody,
        mappings: {
          properties: {
            CUI: { type: 'keyword' },
            preferred_name: {
              type: 'text',
              analyzer: 'english',
              fields: { keyword: { type: 'keyword' } }
            },
            STY: { type: 'keyword' },
            codes: {
              type: 'nested',
              properties: {
                SAB:  { type: 'keyword' },
                CODE: { type: 'keyword' },
                preferred_name: {
                  type: 'text',
                  analyzer: 'english',
                  fields: { keyword: { type: 'keyword' } }
                },
                strings: {
                  type: 'text',
                  analyzer: 'english',
                  fields: { keyword: { type: 'keyword' } }
                }
              }
            }
          }
        }
      }
    });
    console.log('✅ Created index with synonym_analyzer');
  } else {
    // 2b) Update existing index settings
    await es.indices.close({ index: INDEX });
    await es.indices.putSettings({
      index: INDEX,
      body: settingsBody
    });
    await es.indices.open({ index: INDEX });
    console.log('♻️  Updated index settings with new synonyms');
  }

  // 3) Reload the search analyzers so the new synonyms take effect
  await es.indices.reloadSearchAnalyzers({ index: INDEX });
  console.log('🔄 Reloaded search analyzers');
}

ensureSynonymAnalyzer().catch(err => {
  console.error(err);
  process.exit(1);
});
