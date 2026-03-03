const { Client } = require('@elastic/elasticsearch');
const { ES_URL } = require('../../elastic-config');
const es = new Client({ node: ES_URL });

module.exports = es;
