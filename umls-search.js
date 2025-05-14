document.addEventListener("DOMContentLoaded", () => {
    let pages = [], fetchTimeStack = [], totalHits = 0, totalPages = 0;
    let currentPageIndex = 0, pageSize = 10;

    function prepareForSearch(text) {
        return text.normalize("NFKC").toLowerCase()
                   .replace(/\b(\w+)[’']s\b/gi, '$1')
                   .trim();
    }

    function normalizeForExactMatch(text) {
        return text.normalize("NFKC").toLowerCase()
                   .replace(/\b(\w+)[’']s\b/gi, '$1')
                   .trim();
    }

    function escapeHtml(str) {
        return str.replaceAll("&","&amp;")
                  .replaceAll("<","&lt;")
                  .replaceAll(">","&gt;");
    }

    function renderCUIs(hitsArr) {
        const queryExact = normalizeForExactMatch(document.getElementById('query').value);

        return hitsArr.map(hit => {
            const src = hit._source;
            const h = hit.highlight || {};
            const prefHlArray = h.preferred_name || [];
            const codeHlArray = hit.inner_hits?.matched_codes?.hits?.hits.flatMap(h => h._source?.strings || []) || [];

            const prefNameMatch = normalizeForExactMatch(src.preferred_name || '') === queryExact;
            const codesStrings = (src.codes || []).flatMap(c => c.strings || []);
            const codesMatch = codesStrings.some(s => normalizeForExactMatch(s) === queryExact);
            const isExactMatch = prefNameMatch || codesMatch;

            let prefNameDisplay = '';
            const prefNameExactLabel = prefNameMatch ? ' <span style="color:green; font-weight:bold;">(exact)</span>' : '';
            if (prefHlArray.length) {
                prefNameDisplay = prefHlArray.map(frag => {
                    const clean = frag.replace(/<\/?em>/g, '').trim();
                    return escapeHtml(clean) + prefNameExactLabel;
                }).join('<hr style="margin:4px 0;border-color:#ccc;"/>');
            } else if (src.preferred_name) {
                prefNameDisplay = escapeHtml(src.preferred_name) + prefNameExactLabel;
            } else {
                prefNameDisplay = '(none)';
            }

            const otherDisplay = codeHlArray.length
                ? codeHlArray.map(code => {
                    const label = normalizeForExactMatch(code) === queryExact ? ' <span style="color:green; font-weight:bold;">(exact)</span>' : '';
                    return escapeHtml(code) + label;
                }).join('<hr style="margin:4px 0;border-color:#ccc;"/>')
                : '(none)';

            const explainHtml = hit._explanation
                ? `<details><summary>Score Explanation</summary><pre class="explain">${escapeHtml(JSON.stringify(hit._explanation, null, 2))}</pre></details>`
                : '';

            return `<div class="card"><div class="header"><div class="left">${escapeHtml(src.preferred_name || '(no name)')}${isExactMatch ? ' <span style="color:green;font-weight:bold;">✅ EXACT MATCH</span>' : ''}</div><div>${src.CUI}</div><div>${src.STY.map(sty => `<span class="tag">${escapeHtml(sty)}</span>`).join(' ')}</div></div><button class="toggle-btn">Show details</button><div class="details"><table style="border-collapse:collapse;width:100%;"><tr><th style="border:1px solid #ccc;padding:0.3em;text-align:left;">Score</th><td style="border:1px solid #ccc;padding:0.3em;">${hit._score}</td></tr><tr><th style="border:1px solid #ccc;padding:0.3em;text-align:left;">Preferred Name Matches</th><td style="border:1px solid #ccc;padding:0.3em;">${prefNameDisplay}</td></tr><tr><th style="border:1px solid #ccc;padding:0.3em;text-align:left;">Other Matches</th><td style="border:1px solid #ccc;padding:0.3em;">${otherDisplay}</td></tr></table>${explainHtml}</div></div>`;
        }).join('');
    }

    function renderPage() {
        const resultsDiv = document.getElementById('results');
        const fetchTime = fetchTimeStack[0];
        let html = '';
        if (typeof fetchTime === 'number')
            html += `<div style="font-style:italic;margin-bottom:0.5em;">Loaded page ${currentPageIndex+1} in ${fetchTime.toFixed(2)} s</div>`;
        if (totalHits > 0)
            html += `<h2>Page ${currentPageIndex+1} of ${totalPages} – ${totalHits} total results</h2>`;
        else
            html += `<h2>Page ${currentPageIndex+1}</h2>`;
    
        // ✅ THIS IS THE CORRECT LINE
        const hitsPage = pages.slice(currentPageIndex * pageSize, (currentPageIndex + 1) * pageSize);
    
        html += hitsPage.length ? renderCUIs(hitsPage) : `<pre>No results</pre>`;
        resultsDiv.innerHTML = html;
    
        resultsDiv.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.onclick = () => {
                const det = btn.nextElementSibling;
                const shown = det.style.display === 'block';
                det.style.display = shown ? 'none' : 'block';
                btn.textContent = shown ? 'Show details' : 'Hide details';
            };
        });
    
        document.getElementById('prevPage').disabled = currentPageIndex === 0;
        document.getElementById('nextPage').disabled = (currentPageIndex + 1) * pageSize >= pages.length;
        document.getElementById('pagination').style.display = 'block';
    }
    

    async function doSearch(pageIndex = 0) {
        if (pages.length > 0) {
            currentPageIndex = pageIndex;
            return renderPage();
        }
    
        const q = prepareForSearch(document.getElementById('query').value);
        const baseBody = {
            size: 100,
            track_total_hits: true,
            _source: ["preferred_name", "CUI", "STY", "codes"],
            query: { bool: { should: [
                { match_phrase: { "preferred_name": { query: q, boost: 10 } } },
                { match: { "preferred_name": { query: q, operator: "and", boost: 5 } } },
                { nested: {
                    path: "codes",
                    score_mode: "max",
                    query: { bool: { should: [
                        { match_phrase: { "codes.strings": { query: q, boost: 10 } } },
                        { match: { "codes.strings": { query: q, operator: "and", boost: 5 } } }
                    ], minimum_should_match: 1 } },
                    inner_hits: { name: "matched_codes", size: 6, highlight: { fields: { "preferred_name": {}, "codes.strings": {} } } }
                }}
            ], minimum_should_match: 1 }},
            highlight: { fields: { "preferred_name": {}, "codes.strings": {} } },
            explain: true
        };
    
        document.getElementById('apiCall').textContent = `POST /umls-cui/_search\n\n${JSON.stringify(baseBody, null, 2)}`;
        document.getElementById('apiCall').style.display = 'block';
    
        const start = performance.now();
        const res = await fetch('http://localhost:9200/umls-cui/_search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(baseBody)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const duration = (performance.now() - start) / 100;
    
        const hits = data.hits.hits;
        totalHits = data.hits.total.value;
        pages = hits;
    
        const queryExact = normalizeForExactMatch(document.getElementById('query').value);
        const rawQuery = document.getElementById('query').value.toLowerCase();
    
        pages.sort((a, b) => {
            const aExact = (normalizeForExactMatch(a._source.preferred_name || '') === queryExact) ||
                           ((a._source.codes || []).flatMap(c => c.strings || []).some(s => normalizeForExactMatch(s) === queryExact));
            const bExact = (normalizeForExactMatch(b._source.preferred_name || '') === queryExact) ||
                           ((b._source.codes || []).flatMap(c => c.strings || []).some(s => normalizeForExactMatch(s) === queryExact));
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
    
        totalPages = Math.ceil(pages.length / pageSize);
        fetchTimeStack = [duration];
        currentPageIndex = pageIndex;
        renderPage();
    
        // ✅ progressive load of remainder
        if (totalHits > 100) {
            const remainderRes = await fetch('http://localhost:9200/umls-cui/_search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...baseBody, size: totalHits - 100, from: 100 })
            });
            if (!remainderRes.ok) return;
            const remainderData = await remainderRes.json();
            const moreHits = remainderData.hits.hits;
    
            pages = pages.concat(moreHits);
    
            pages.sort((a, b) => {
                const aExact = (normalizeForExactMatch(a._source.preferred_name || '') === queryExact) ||
                               ((a._source.codes || []).flatMap(c => c.strings || []).some(s => normalizeForExactMatch(s) === queryExact));
                const bExact = (normalizeForExactMatch(b._source.preferred_name || '') === queryExact) ||
                               ((b._source.codes || []).flatMap(c => c.strings || []).some(s => normalizeForExactMatch(s) === queryExact));
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
    
            totalPages = Math.ceil(pages.length / pageSize);
            // optionally refresh pagination buttons if user hasn't moved pages
            if (currentPageIndex === pageIndex) renderPage();
        }
    }
    

    document.getElementById('searchForm').addEventListener('submit', e => {
        e.preventDefault();
        pages = [];
        fetchTimeStack = [];
        totalHits = 0;
        totalPages = 0;
        currentPageIndex = 0;
        doSearch(0).catch(err => {
            document.getElementById('results').innerHTML = `<pre style="color:red;">❌ ${err.message}</pre>`;
        });
    });

    document.getElementById('prevPage').addEventListener('click', () => {
        if (currentPageIndex > 0) doSearch(currentPageIndex - 1);
    });

    document.getElementById('nextPage').addEventListener('click', () => {
        if ((currentPageIndex + 1) * pageSize < pages.length) doSearch(currentPageIndex + 1);
    });
});
