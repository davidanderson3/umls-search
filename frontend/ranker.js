(function(global) {
    function prepareForSearch(text) {
        return text.normalize("NFKC").toLowerCase()
            .replace(/\b(\w+)[’']s\b/gi, '$1')
            .trim();
    }

    function customRank(hits, query) {
        const queryExact = prepareForSearch(query);
        const rawQuery = query.toLowerCase();

        return hits.sort((a, b) => {
            const normalize = text => prepareForSearch(text || '');

            const aExact = (normalize(a._source.preferred_name) === queryExact) ||
                ((a._source.codes || []).flatMap(c => c.strings || []).some(s => normalize(s) === queryExact));

            const bExact = (normalize(b._source.preferred_name) === queryExact) ||
                ((b._source.codes || []).flatMap(c => c.strings || []).some(s => normalize(s) === queryExact));

            if (bExact !== aExact) return bExact - aExact;

            const aAtoms = (a._source.codes || []).flatMap(c => c.strings || [])
                .filter(s => s.toLowerCase().includes(rawQuery)).length;
            const bAtoms = (b._source.codes || []).flatMap(c => c.strings || [])
                .filter(s => s.toLowerCase().includes(rawQuery)).length;

            if (aAtoms !== bAtoms) return bAtoms - aAtoms;

            const aLen = (a._source.preferred_name || '').split(/\s+/).length;
            const bLen = (b._source.preferred_name || '').split(/\s+/).length;
            return aLen - bLen;
        });
    }

    // Export for Node.js (backend)
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { prepareForSearch, customRank };
    }

    // Attach to window for browser (frontend)
    if (typeof global.window !== 'undefined') {
        global.window.prepareForSearch = prepareForSearch;
        global.window.customRank = customRank;
    }

})(typeof global !== 'undefined' ? global : this);
