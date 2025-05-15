document.addEventListener("DOMContentLoaded", () => {
    // ======================
    // Config
    // ======================
    const CONFIG = {
        pageSize: 100,
        backendUrl: '/api/search'
    };

    const SELECTORS = {
        queryInput: 'query',
        apiCall: 'apiCall',
        results: 'results',
        searchForm: 'searchForm',
        prevButtons: ['prevPage', 'prevPageTop'],
        nextButtons: ['nextPage', 'nextPageTop'],
        pagination: ['pagination', 'paginationTop']
    };

    // ======================
    // State
    // ======================
    let pages = [], fetchTimeStack = [], totalHits = 0, totalPages = 0;
    let currentPageIndex = 0;

    // ======================
    // Helpers
    // ======================
    const $ = id => document.getElementById(id);

    // ✅ LOCAL helper only (no global sharing anymore)
    function prepareForSearch(text) {
        return text.normalize("NFKC").toLowerCase()
            .replace(/\b(\w+)[’']s\b/gi, '$1')
            .trim();
    }

    function escapeHtml(str) {
        return str.replaceAll("&","&amp;")
                  .replaceAll("<","&lt;")
                  .replaceAll(">","&gt;");
    }

    function getQueryInput() {
        return $(SELECTORS.queryInput).value;
    }

    function setApiCallText(q, pageIndex) {
        const text = `GET ${CONFIG.backendUrl}?q=${q}&page=${pageIndex}&size=${CONFIG.pageSize}`;
        const el = $(SELECTORS.apiCall);
        el.textContent = text;
        el.style.display = 'block';
    }

    function setPaginationButtons() {
        const disablePrev = currentPageIndex <= 0;
        const disableNext = currentPageIndex >= (totalPages - 1);

        SELECTORS.prevButtons.forEach(id => $(id).disabled = disablePrev);
        SELECTORS.nextButtons.forEach(id => $(id).disabled = disableNext);
        SELECTORS.pagination.forEach(id => $(id).style.display = 'block');
    }

    // ======================
    // UI Rendering
    // ======================
    function renderCUIs(hitsArr) {
        const queryExact = prepareForSearch(getQueryInput());

        return hitsArr.map(hit => {
            const src = hit._source;
            const prefName = src.preferred_name || '';
            const prefNameMatch = prepareForSearch(prefName) === queryExact;

            const codesStrings = (src.codes || []).flatMap(c => c.strings || []);
            const codesMatch = codesStrings.some(s => prepareForSearch(s) === queryExact);
            const isExactMatch = prefNameMatch || codesMatch;

            const prefNameDisplay = prefName ? escapeHtml(prefName) : '(none)';

            return `
            <div class="card">
                <div class="header">
                    <div class="left">
                        ${prefNameDisplay}
                        ${isExactMatch ? ' <span style="color:green;font-weight:bold;">✅ EXACT</span>' : ''}
                    </div>
                    <div>
                        CUI: ${src.CUI ? `<a href="https://uts.nlm.nih.gov/uts/umls/concept/${escapeHtml(src.CUI)}" target="_blank" rel="noopener noreferrer">${escapeHtml(src.CUI)}</a>` : '(none)'}
                    </div>
                    <div>
                        ${(src.STY || []).map(sty => `<span class="tag">${escapeHtml(sty)}</span>`).join(' ')}
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    function renderPage() {
        const resultsDiv = $(SELECTORS.results);
        const fetchTime = fetchTimeStack[0];
        let html = '';

        if (typeof fetchTime === 'number') {
            html += `<div style="font-style:italic;margin-bottom:0.5em;">
                        Loaded page ${currentPageIndex + 1} in ${fetchTime.toFixed(2)} s
                     </div>`;
        }

        html += totalHits > 0
            ? `<h2>Page ${currentPageIndex + 1} of ${totalPages} – ${totalHits} total results</h2>`
            : `<h2>Page ${currentPageIndex + 1}</h2>`;

        html += pages.length ? renderCUIs(pages) : `<pre>No results</pre>`;
        resultsDiv.innerHTML = html;

        setPaginationButtons();
    }

    // ======================
    // Search Logic
    // ======================
    async function doSearch(pageIndex = 0) {
        const q = prepareForSearch(getQueryInput());
        setApiCallText(q, pageIndex);

        const start = performance.now();
        const res = await fetch(`${CONFIG.backendUrl}?q=${encodeURIComponent(q)}&page=${pageIndex + 1}&size=${CONFIG.pageSize}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const duration = (performance.now() - start) / 1000;

        totalHits = data.total;
        pages = data.results;

        totalPages = Math.ceil(totalHits / CONFIG.pageSize);
        fetchTimeStack = [duration];
        currentPageIndex = pageIndex;
        renderPage();
    }

    // ======================
    // Event Listeners
    // ======================
    $(SELECTORS.searchForm).addEventListener('submit', e => {
        e.preventDefault();
        pages = [];
        fetchTimeStack = [];
        totalHits = 0;
        totalPages = 0;
        currentPageIndex = 0;

        doSearch(0).catch(err => {
            $(SELECTORS.results).innerHTML = `<pre style="color:red;">❌ ${err.message}</pre>`;
        });
    });

    SELECTORS.prevButtons.forEach(id => {
        $(id).addEventListener('click', () => {
            if (currentPageIndex > 0) doSearch(currentPageIndex - 1);
        });
    });

    SELECTORS.nextButtons.forEach(id => {
        $(id).addEventListener('click', () => {
            if (currentPageIndex < totalPages - 1) doSearch(currentPageIndex + 1);
        });
    });
});
