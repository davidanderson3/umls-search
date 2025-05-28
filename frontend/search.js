import { getQueryInput, prepareForSearch } from './utils.js';
import { renderPage } from './render.js';

const CONFIG = {
    pageSize: 100,
    backendUrl: '/api/search'
};

export function initState() {

    window.pages = [];
    window.fetchTimeStack = [];
    window.totalHits = 0;
    window.totalPages = 0;
    window.currentPageIndex = 0;

}

export async function doSearch(pageIndex = 0) {
    const q = prepareForSearch(getQueryInput());
    const fuzzy = document.getElementById('fuzzyToggle')?.checked || false;
    const page = pageIndex + 1;
    const size = CONFIG.pageSize;

    const relativeUrl = `${CONFIG.backendUrl}?q=${encodeURIComponent(q)}&page=${page}&size=${size}&fuzzy=${fuzzy}`;
    const fullUrl = `http://localhost:3000${relativeUrl}`; // ⬅️ Full absolute URL
    const start = performance.now();

    // ✅ Show clickable API link
    const apiCallLink = document.getElementById('apiCallLink');
    if (apiCallLink) {
        apiCallLink.href = fullUrl;
        apiCallLink.textContent = fullUrl;
    }

    const res = await fetch(relativeUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const duration = (performance.now() - start) / 1000;

    // Log the full API response
    console.log('API Response:', data.results);

    // Log malformed hits
    const malformedHits = data.results.filter(hit => !hit.preferred_name || typeof hit.preferred_name !== 'string');
    console.log('Malformed Hits:', malformedHits);

    window.totalHits = data.total;
    window.pages = data.results
        .filter(hit => hit !== null && hit !== undefined) // Ensure no null or undefined hits
        .map(hit => ({
            CUI: hit.CUI || null,
            preferred_name: hit.preferred_name, // No safeguard needed
            STY: Array.isArray(hit.STY) ? hit.STY : [],
            codes: Array.isArray(hit.codes) ? hit.codes : [],
            definitions: Array.isArray(hit.definitions) ? hit.definitions : [],
            matchType: hit.matchType || null,
            _customScore: hit._customScore || 0
        }));
    window.totalPages = Math.ceil(data.total / CONFIG.pageSize);
    window.fetchTimeStack = [duration];
    window.currentPageIndex = pageIndex;

    renderPage();
}



