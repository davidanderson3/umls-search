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
    const start = performance.now();

    const res = await fetch(`${CONFIG.backendUrl}?q=${encodeURIComponent(q)}&page=${pageIndex + 1}&size=${CONFIG.pageSize}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const duration = (performance.now() - start) / 1000;

    window.totalHits = data.total;
    window.pages = data.results;
    window.totalPages = Math.ceil(data.total / CONFIG.pageSize);
    window.fetchTimeStack = [duration];
    window.currentPageIndex = pageIndex;

    renderPage();
}
