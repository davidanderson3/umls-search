document.addEventListener("DOMContentLoaded", () => {
    let pages = [], fetchTimeStack = [], totalHits = 0, totalPages = 0;
    let currentPageIndex = 0, pageSize = 100;

    function prepareForSearch(text) {
        return text.normalize("NFKC").toLowerCase()
                   .replace(/\b(\w+)[’']s\b/gi, '$1')
                   .trim();
    }

    function normalizeForExactMatch(text) {
        return prepareForSearch(text);
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

            const prefNameMatch = normalizeForExactMatch(src.preferred_name || '') === queryExact;
            const codesStrings = (src.codes || []).flatMap(c => c.strings || []);
            const codesMatch = codesStrings.some(s => normalizeForExactMatch(s) === queryExact);
            const isExactMatch = prefNameMatch || codesMatch;

            const scoreDisplay = (typeof hit._score === 'number') ? hit._score.toFixed(2) : '(n/a)';
            const prefNameDisplay = src.preferred_name ? escapeHtml(src.preferred_name) : '(none)';
            const prefMatchDisplay = prefNameMatch ? '✅' : '—';
            const codesMatchDisplay = codesMatch ? '✅' : '—';

            return `<div class="card">
                <div class="header">
                    <div class="left">${prefNameDisplay}${isExactMatch ? ' <span style="color:green;font-weight:bold;">✅ EXACT</span>' : ''}</div>
                    <div>CUI: ${src.CUI ? `<a href="https://uts.nlm.nih.gov/uts/umls/concept/${escapeHtml(src.CUI)}" target="_blank" rel="noopener noreferrer">${escapeHtml(src.CUI)}</a>` : '(none)'}</div>
                    <div>${(src.STY || []).map(sty => `<span class="tag">${escapeHtml(sty)}</span>`).join(' ')}</div>
                    <div>Score: ${scoreDisplay}</div>
                </div>
            </div>`;
        }).join('');
    }

    function renderPage() {
        const resultsDiv = document.getElementById('results');
        const fetchTime = fetchTimeStack[0];
        let html = '';

        if (typeof fetchTime === 'number')
            html += `<div style="font-style:italic;margin-bottom:0.5em;">Loaded page ${currentPageIndex + 1} in ${fetchTime.toFixed(2)} s</div>`;

        if (totalHits > 0)
            html += `<h2>Page ${currentPageIndex + 1} of ${totalPages} – ${totalHits} total results</h2>`;
        else
            html += `<h2>Page ${currentPageIndex + 1}</h2>`;

        const hitsPage = pages; // ✅ No slicing anymore
        html += hitsPage.length ? renderCUIs(hitsPage) : `<pre>No results</pre>`;

        resultsDiv.innerHTML = html;

        // ✅ Update pagination buttons
        ['prevPage', 'prevPageTop'].forEach(id => {
            document.getElementById(id).disabled = currentPageIndex <= 0;
        });
        ['nextPage', 'nextPageTop'].forEach(id => {
            document.getElementById(id).disabled = currentPageIndex >= (totalPages - 1);
        });

        document.getElementById('pagination').style.display = 'block';
        document.getElementById('paginationTop').style.display = 'block';
    }

    async function doSearch(pageIndex = 0) {
        const q = prepareForSearch(document.getElementById('query').value);

        document.getElementById('apiCall').textContent = 
            `GET /api/search?q=${q}&page=${pageIndex}&size=${pageSize}`;
        document.getElementById('apiCall').style.display = 'block';

        const start = performance.now();
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&page=${pageIndex + 1}&size=${pageSize}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const duration = (performance.now() - start) / 1000;

        totalHits = data.total;
        pages = data.results;

        if (typeof window.customRank === 'function') {
            pages = window.customRank(pages, document.getElementById('query').value);
        }

        totalPages = Math.ceil(totalHits / pageSize);
        fetchTimeStack = [duration];
        currentPageIndex = pageIndex;
        renderPage();
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

    ['prevPage', 'prevPageTop'].forEach(id => {
        document.getElementById(id).addEventListener('click', () => {
            if (currentPageIndex > 0) doSearch(currentPageIndex - 1);
        });
    });

    ['nextPage', 'nextPageTop'].forEach(id => {
        document.getElementById(id).addEventListener('click', () => {
            if (currentPageIndex < totalPages - 1) doSearch(currentPageIndex + 1);
        });
    });
});
