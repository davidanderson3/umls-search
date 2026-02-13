const { Client } = require('@elastic/elasticsearch');

const ES_URL = process.env.ES_URL || 'http://127.0.0.1:9200';
const es = new Client({ node: ES_URL });

module.exports = es;
