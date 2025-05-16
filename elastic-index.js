// elastic-index.js
const { Client } = require('@elastic/elasticsearch');
const fs = require('fs');
const path = require('path');

const SYNONYM_FILE_PATH = path.join(__dirname, 'synonyms.txt');
const synonymsText = fs.readFileSync(SYNONYM_FILE_PATH, 'utf-8').split('\n').map(s => s.trim()).filter(Boolean);


const INDEX = 'umls-cui';
const es = new Client({
    node: 'http://127.0.0.1:9200',
    compatibility: { version: 8 }
});

async function ensureSynonymAnalyzer() {
    const settingsBody = {
        analysis: {
            filter: {
                custom_synonym_filter: {
                    type: 'synonym_graph',
                    synonyms: synonymsText
                }
            },
            normalizer: {
                lowercase_normalizer: {
                    type: 'custom',
                    filter: ['lowercase'],
                    char_filter: []
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

    const mappingProps = {
        CUI: { 
            type: 'keyword',
            fields: {
                lowercase_keyword: {
                    type: 'keyword',
                    normalizer: 'lowercase_normalizer'
                }
            }
        },
        STY: { type: 'keyword' },
        preferred_name: {
            type: 'text',
            analyzer: 'english',
            search_analyzer: 'synonym_analyzer',
            fields: {
                keyword: { type: 'keyword' },
                lowercase_keyword: {
                    type: 'keyword',
                    normalizer: 'lowercase_normalizer'
                }
            }
        },
        codes: {
            type: 'nested',
            properties: {
                SAB: { type: 'keyword' },
                CODE: { 
                    type: 'keyword',
                    fields: {
                        lowercase_keyword: {
                            type: 'keyword',
                            normalizer: 'lowercase_normalizer'
                        }
                    }
                },
                preferred_name: {
                    type: 'text',
                    fields: {
                        keyword: { type: 'keyword' },
                        lowercase_keyword: {
                            type: 'keyword',
                            normalizer: 'lowercase_normalizer'
                        }
                    }
                },
                strings: {
                    type: 'text',
                    analyzer: 'english',
                    search_analyzer: 'synonym_analyzer',
                    fields: {
                        keyword: { type: 'keyword' },
                        lowercase_keyword: {
                            type: 'keyword',
                            normalizer: 'lowercase_normalizer'
                        }
                    }
                }
            }
        }
    };

    const exists = await es.indices.exists({ index: INDEX });

    if (!exists) {
        await es.indices.create({
            index: INDEX,
            body: {
                settings: settingsBody,
                mappings: { properties: mappingProps }
            }
        });
        console.log('✅ Created index with synonyms + lowercase keyword support');
    } else {
        await es.indices.close({ index: INDEX });
        await es.indices.putSettings({ index: INDEX, body: settingsBody });
        await es.indices.putMapping({ index: INDEX, body: { properties: mappingProps } });
        await es.indices.open({ index: INDEX });
        console.log('♻️  Updated index with synonyms + lowercase keyword support');
    }

    await es.indices.reloadSearchAnalyzers({ index: INDEX });
    console.log('🔄 Reloaded search analyzers');
}

ensureSynonymAnalyzer().catch(err => {
    console.error('Error ensuring synonym analyzer:', err);
    process.exit(1);
});

