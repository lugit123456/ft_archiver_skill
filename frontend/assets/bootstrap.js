/**
 * Load the primary archive index and replace its TE records with the configured
 * Economist index before starting the application.
 */
(function () {
    'use strict';

    const config = window.PAPER_ARCHIVE_CONFIG || {};

    function normalizeRoot(value, fallback) {
        const root = String(value || fallback || '');
        return root.endsWith('/') ? root : root + '/';
    }

    function indexUrl(explicitUrl, root) {
        return String(explicitUrl || '').trim() || root + 'database_index.js';
    }

    function cacheBusted(url) {
        const separator = String(url).includes('?') ? '&' : '?';
        return `${url}${separator}v=${Date.now()}`;
    }

    function loadIndex(url, sourceName) {
        return new Promise((resolve, reject) => {
            window.paper_db_index = undefined;
            const script = document.createElement('script');
            script.dataset.paperIndexSource = sourceName;
            script.src = cacheBusted(url);
            script.onload = () => {
                const index = window.paper_db_index;
                if (!Array.isArray(index)) {
                    reject(new Error(`${sourceName} 数据索引格式无效：${url}`));
                    return;
                }
                resolve(index);
            };
            script.onerror = () => reject(new Error(`${sourceName} 数据索引加载失败：${url}`));
            document.body.appendChild(script);
        });
    }

    function attachDatabaseRoot(items, root) {
        return items.map(item => ({ ...item, database_root: root }));
    }

    function databaseUrl(item, root) {
        const path = String(item && item.database_path || '').trim();
        return path ? root + path : '';
    }

    async function databaseIsReachable(item, root) {
        const url = databaseUrl(item, root);
        if (!url) return false;

        const headResponse = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        if (headResponse.ok) return true;
        if (![405, 501].includes(headResponse.status)) return false;

        const getResponse = await fetch(url, {
            method: 'GET',
            cache: 'no-store',
            headers: { Range: 'bytes=0-0' },
        });
        if (getResponse.body) {
            try {
                await getResponse.body.cancel();
            } catch (error) {
                console.warn(`取消 database.js 探测响应失败：${url}`, error);
            }
        }
        return getResponse.ok;
    }

    async function filterReachablePrimaryTe(items, root) {
        const results = await Promise.all(items.map(async item => {
            const url = databaseUrl(item, root);
            try {
                if (await databaseIsReachable(item, root)) return item;
                console.warn(`已过滤不可访问的 The Economist 旧期数据：${url || item.id || 'unknown'}`);
            } catch (error) {
                console.warn(`探测 The Economist 旧期数据失败，已过滤：${url || item.id || 'unknown'}`, error);
            }
            return null;
        }));
        return results.filter(Boolean);
    }
    function deduplicate(items) {
        const unique = new Map();
        items.forEach(item => {
            const key = item.id || [item.publication_type, item.publication_date, item.database_path].join('|');
            unique.set(key, item);
        });
        return [...unique.values()];
    }

    function loadApp() {
        const appScript = document.createElement('script');
        appScript.src = `assets/app.js?v=${encodeURIComponent(window.PAPER_FRONTEND_VERSION || '1')}`;
        document.body.appendChild(appScript);
    }

    async function start() {
        const primaryRoot = normalizeRoot(config.primaryDatabaseRoot, '../output_results/');
        const teRoot = normalizeRoot(
            config.teDatabaseRoot,
            '/economist-output/'
        );
        let primaryItems = [];
        let economistItems = [];

        try {
            primaryItems = await loadIndex(indexUrl(config.primaryIndexUrl, primaryRoot), '主资料库');
        } catch (error) {
            console.error(error);
        }

        try {
            economistItems = await loadIndex(indexUrl(config.teIndexUrl, teRoot), 'The Economist');
        } catch (error) {
            console.warn(error);
        }

        const primaryNonTe = primaryItems.filter(item => item.publication_type !== 'TE');
        const primaryTe = primaryItems.filter(item => item.publication_type === 'TE');
        const externalTe = economistItems.filter(item => item.publication_type === 'TE');
        let selectedTe = [];
        if (externalTe.length) {
            selectedTe = attachDatabaseRoot(externalTe, teRoot);
        } else if (config.teFallbackToPrimary !== false) {
            const reachablePrimaryTe = await filterReachablePrimaryTe(primaryTe, primaryRoot);
            selectedTe = attachDatabaseRoot(reachablePrimaryTe, primaryRoot);
        }

        if (!externalTe.length && primaryTe.length && config.teFallbackToPrimary === false) {
            console.warn('The Economist 外部数据不可用，已忽略主资料库中的旧 TE 数据。');
        }

        window.PAPER_DATABASE_ROOT = primaryRoot;
        window.paper_db_index = deduplicate([
            ...attachDatabaseRoot(primaryNonTe, primaryRoot),
            ...selectedTe,
        ]);

        if (!window.paper_db_index.length) {
            const empty = document.getElementById('empty-state');
            if (empty) empty.hidden = false;
        }
        loadApp();
    }

    start();
})();
