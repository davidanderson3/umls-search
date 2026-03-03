const DEFAULT_ES_URL = 'http://127.0.0.1:9200';
const DEFAULT_ES_INDEX = 'umls-cui';

const ES_URL = process.env.ES_URL || DEFAULT_ES_URL;
const ES_INDEX = process.env.ES_INDEX || DEFAULT_ES_INDEX;

module.exports = {
    DEFAULT_ES_INDEX,
    DEFAULT_ES_URL,
    ES_INDEX,
    ES_URL
};
