// elastic-index.js
const { Client } = require('@elastic/elasticsearch');
const SYNONYMS = require('./synonyms.json');

const INDEX = 'umls-cui';
const es = new Client({
  node: 'http://127.0.0.1:9200',
  compatibility: { version: 8 }
});

async function ensureSynonymAnalyzer() {
  // 1) Shared analyzer settings
  const settingsBody = {
    analysis: {
      filter: {
        custom_synonym_filter: {
          type:     'synonym_graph',
          synonyms: SYNONYMS
        }
      },
      analyzer: {
        default: { type: 'english' },
        synonym_analyzer: {
          tokenizer: 'standard',
          filter: [
            'lowercase',
            'custom_synonym_filter',
            'stop',
            'porter_stem'
          ]
        }
      }
    }
    
    
  };

  // 2) Mapping with search_analyzer on text fields
  const mappingProps = {
    CUI: { type: 'keyword' },
    STY: { type: 'keyword' },

    preferred_name: {
      type:            'text',
      analyzer:        'english',
      search_analyzer: 'synonym_analyzer',
      fields: {
        keyword: { type: 'keyword' }
      }
    },

    codes: {
      type: 'nested',
      properties: {
        SAB:  { type: 'keyword' },
        CODE: { type: 'keyword' },

        preferred_name: {
          type:            'text',
          analyzer:        'english',
          search_analyzer: 'synonym_analyzer',
          fields: {
            keyword: { type: 'keyword' }
          }
        },
        strings: {
          type:            'text',
          analyzer:        'english',
          search_analyzer: 'synonym_analyzer',
          fields: {
            keyword: { type: 'keyword' }
          }
        }
      }
    }
  };

  // 3) Check for index
  const exists = await es.indices.exists({ index: INDEX });

  if (!exists) {
    // 3a) Create if missing
    await es.indices.create({
      index: INDEX,
      body: {
        settings: settingsBody,
        mappings: {
          properties: mappingProps
        }
      }
    });
    console.log('✅ Created index with mapping‑level synonyms');
  } else {
    // 3b) Update settings & mapping on existing index
    await es.indices.close({ index: INDEX });

    await es.indices.putSettings({
      index: INDEX,
      body: settingsBody
    });

    await es.indices.putMapping({
      index: INDEX,
      body: {
        properties: mappingProps
      }
    });

    await es.indices.open({ index: INDEX });

    console.log('♻️  Updated index settings and mapping with synonyms');
  }

  // 4) Reload so new analyzers take effect
  await es.indices.reloadSearchAnalyzers({ index: INDEX });
  console.log('🔄 Reloaded search analyzers');
}

ensureSynonymAnalyzer().catch(err => {
  console.error('Error ensuring synonym analyzer:', err);
  process.exit(1);
});
