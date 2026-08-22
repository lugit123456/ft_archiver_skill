/**
 * auto-paper-md-converter · frontend
 * 纯静态页面。先读取 window.paper_db_index，点进某期后再懒加载该 PDF 的 database.js。
 */

(function () {
    'use strict';

    const INDEX = Array.isArray(window.paper_db_index) ? window.paper_db_index : [];
    const DATABASE_ROOT = window.PAPER_DATABASE_ROOT || '../output_results/';
    const THEME_KEY = 'auto_paper_frontend_theme';
    const PUBLICATION_STORAGE_KEY = 'auto_paper_frontend_publication';
    const PUBLICATION_NAMES = {
        WSJ: 'The Wall Street Journal',
        FT: 'Financial Times',
        TE: 'The Economist',
    };
    const PUBLICATION_ORDER = ['WSJ', 'FT', 'TE'];
    const PRINT_SECTION_DISPLAY_NAMES = Object.freeze({
        'PAGE ONE': '头版',
        'U.S. NEWS': 'U.S. News',
        'WORLD NEWS': 'World News',
        'BUSINESS & FINANCE': 'Business & Finance',
        'BUSINESS INSIGHT': 'Business Insight',
        'MONEY & INVESTING': 'Money & Investing',
        'THE WORLD THIS WEEK': 'The World This Week',
        'LIFE & ARTS': 'Life & Arts',
        'ARTS & CULTURE': 'Arts & Culture',
        'SCIENCE & TECHNOLOGY': 'Science & Technology',
        'TECHNOLOGY': 'Technology',
        'NATIONAL': 'National',
        'OPINION': 'Opinion',
        'SPORTS': 'Sports',
        'EXCHANGE': 'Exchange',
    });
    const WHATS_NEWS_GROUP_NAMES = Object.freeze({
        'BUSINESS & FINANCE': '商业与金融',
        'WORLDWIDE': '全球要闻',
        'BRIEFING': '简报',
    });
    const WHATS_NEWS_STOP_WORDS = new Set([
        'about', 'after', 'again', 'against', 'also', 'among', 'and', 'are',
        'because', 'been', 'before', 'being', 'between', 'but', 'can', 'could',
        'did', 'does', 'for', 'from', 'had', 'has', 'have', 'her', 'his',
        'into', 'its', 'more', 'new', 'not', 'over', 'said', 'that', 'the',
        'their', 'them', 'they', 'this', 'through', 'under', 'was', 'were',
        'will', 'with', 'would', 'year', 'years',
    ]);

    if (typeof marked !== 'undefined' && marked.setOptions) {
        marked.setOptions({
            breaks: true,
            gfm: true,
            headerIds: false,
            mangle: false,
        });
    }


    function getPublicationFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const type = params.get('type');
        if (type && PUBLICATION_NAMES[type.toUpperCase()]) {
            return type.toUpperCase();
        }
        return null;
    }

    function getSavedPublication() {
        try {
            const saved = localStorage.getItem(PUBLICATION_STORAGE_KEY);
            if (saved && PUBLICATION_NAMES[saved]) {
                return saved;
            }
        } catch (e) {}
        return null;
    }

    function savePublication(publication) {
        try {
            if (publication) {
                localStorage.setItem(PUBLICATION_STORAGE_KEY, publication);
            }
        } catch (e) {}
    }
    const state = {
        currentPublication: null,
        currentIssueId: null,
        currentArticleId: null,
        currentIssueView: null,
        currentPageLabel: null,
        currentIssue: null,
        currentArticles: [],
        issueSearchIssueId: null,
        issueSearchQuery: '',
        issueLoadToken: 0,
    };
    let viewTransitionToken = 0;
    let viewTransitionTimer = null;

    const lightboxState = { images: [], idx: 0 };
    const glossaryUiState = {
        activeButton: null,
        pinned: false,
        hideTimer: null,
        returnFocus: null,
    };
    const tocUiState = {
        returnFocus: null,
        hideTimer: null,
    };

    function escapeHtml(value) {
        if (value == null) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function stripHtml(html) {
        return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function displayFilename(filename) {
        return String(filename || '').replace(/^\s*\[[^\]]+\]\s*/, '');
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        if (Number.isNaN(d.getTime())) return dateStr;
        return [
            d.getFullYear(),
            String(d.getMonth() + 1).padStart(2, '0'),
            String(d.getDate()).padStart(2, '0'),
        ].join('-');
    }

    function publicationName(value) {
        const publication = String(value || 'General');
        return PUBLICATION_NAMES[publication] || publication;
    }

    function comparePublications(left, right) {
        const leftIndex = PUBLICATION_ORDER.indexOf(left);
        const rightIndex = PUBLICATION_ORDER.indexOf(right);
        if (leftIndex >= 0 || rightIndex >= 0) {
            return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
        }
        return publicationName(left).localeCompare(publicationName(right));
    }

    function todayChinese() {
        return new Date().toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long',
        });
    }

    function dirname(path) {
        const parts = String(path || '').split('/');
        parts.pop();
        return parts.join('/');
    }

    function databaseRoot(issue) {
        const root = String(issue?.database_root || DATABASE_ROOT);
        return root.endsWith('/') ? root : root + '/';
    }

    function issueBasePath(issue) {
        const dbPath = issue && issue.database_path ? issue.database_path : '';
        const dir = dirname(dbPath);
        return databaseRoot(issue) + (dir ? dir + '/' : '');
    }

    function resolveIssueAsset(issue, path) {
        if (!path) return '';
        const raw = String(path);
        if (/^(https?:|data:|file:)/i.test(raw)) return raw;
        const normalized = raw.replace(/^\.\//, '').replace(/^\.\.\//, '');
        if (normalized.startsWith('output_results/')) return '../' + normalized;
        if (normalized.startsWith('frontend/')) return '../' + normalized;
        return issueBasePath(issue) + normalized.replace(/^images\//, 'images/');
    }

    function renderMarkdown(markdown, issue) {
        const rewritten = rewriteMarkdownAssetPaths(markdown || '', issue);
        if (typeof marked !== 'undefined') {
            try {
                return marked.parse(rewritten);
            } catch (error) {
                console.warn('marked parse failed', error);
            }
        }
        return escapeHtml(rewritten).replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>');
    }

    function rewriteMarkdownAssetPaths(markdown, issue) {
        const base = issueBasePath(issue);
        return String(markdown || '')
            .replace(/\]\((?:\.\.\/)?images\//g, `](${base}images/`)
            .replace(/src=["'](?:\.\.\/)?images\//g, match => match.replace(/(?:\.\.\/)?images\//, `${base}images/`));
    }

    function parseHash() {
        const raw = window.location.hash.replace(/^#\/?/, '');
        const parts = raw.split('/').filter(Boolean);
        if (parts[0] === 'publication' && parts[1]) {
            return { publication: decodeURIComponent(parts[1]), issueId: null, view: null, articleId: null, pageLabel: null };
        }
        if (parts[0] === 'issue' && parts[1]) {
            const issueId = decodeURIComponent(parts[1]);
            if (parts[2] === 'frontpage') {
                return { publication: null, issueId, view: 'frontpage', articleId: null, pageLabel: null };
            }
            if (parts[2] === 'page' && parts[3]) {
                return {
                    publication: null,
                    issueId,
                    view: 'page',
                    articleId: null,
                    pageLabel: decodeURIComponent(parts.slice(3).join('/')),
                };
            }
            return {
                publication: null,
                issueId,
                view: parts[2] ? 'article' : null,
                articleId: decodeURIComponent(parts[2] || '') || null,
                pageLabel: null,
            };
        }
        return { publication: null, issueId: null, view: null, articleId: null, pageLabel: null };
    }

    function navigate(path, replace) {
        const hash = path.startsWith('#') ? path : '#' + path;
        if (replace) {
            window.history.replaceState(null, '', window.location.pathname + window.location.search + hash);
            route();
        } else {
            window.location.hash = hash;
        }
    }

    function switchView(viewId, onShown) {
        const next = document.getElementById(viewId);
        if (!next) return;
        const transitionToken = ++viewTransitionToken;
        if (viewTransitionTimer !== null) {
            clearTimeout(viewTransitionTimer);
            viewTransitionTimer = null;
        }
        document.querySelectorAll('.view.is-leaving').forEach(view => view.classList.remove('is-leaving'));

        const current = document.querySelector('.view.is-active');
        if (current && current !== next) {
            current.classList.add('is-leaving');
            viewTransitionTimer = setTimeout(() => {
                if (transitionToken !== viewTransitionToken) return;
                viewTransitionTimer = null;
                current.classList.remove('is-active', 'is-leaving');
                next.classList.add('is-active');
                if (typeof onShown === 'function') onShown();
            }, 220);
        } else if (!current) {
            next.classList.add('is-active');
            if (typeof onShown === 'function') onShown();
        } else if (typeof onShown === 'function') {
            onShown();
        }
    }

    function scrollDocumentToTop() {
        const forceTop = () => {
            const el = document.scrollingElement || document.documentElement;
            if (el) el.scrollTop = 0;
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
            window.scrollTo(0, 0);
        };
        forceTop();
        requestAnimationFrame(forceTop);
        setTimeout(forceTop, 120);
    }

    function issueSearchText(issue) {
        return [
            issue.id,
            issue.publication_type,
            publicationName(issue.publication_type),
            issue.publication_date,
            issue.original_filename,
            (issue.sections || []).join(' '),
            (issue.titles || []).join(' '),
        ].join(' ').toLowerCase();
    }

    function renderCoverCard(issue) {
        const dateLabel = formatDate(issue.publication_date);
        const publication = issue.publication_type || 'General';
        const publicationLabel = publicationName(publication);
        const articleCount = issue.article_count || 0;
        const initials = publication.slice(0, 3).toUpperCase();
        const filename = displayFilename(issue.original_filename || issue.id || '');
        const cover = resolveIssueAsset(issue, issue.cover_image || '');
        const showWeekend = Object.prototype.hasOwnProperty.call(issue, 'is_weekend')
            && issue.is_weekend === true;
        return `
            <article class="cover-card" data-issue-id="${escapeHtml(issue.id)}"
                     data-search="${escapeHtml(issueSearchText(issue))}">
                <div class="cover-image-wrap">
                    ${cover ? `<img class="cover-image" src="${escapeHtml(cover)}" alt="${escapeHtml(publicationLabel)} ${escapeHtml(dateLabel)}" loading="lazy">` : ''}
                    <div class="cover-image-fallback" ${cover ? 'hidden' : ''}>${escapeHtml(initials)}</div>
                </div>
                <div class="cover-body">
                    <div class="cover-date-row">
                        <div class="cover-date">${escapeHtml(dateLabel)}</div>
                        ${showWeekend ? '<span class="cover-weekend-label">周末版</span>' : ''}
                    </div>
                    <div class="cover-id">${escapeHtml(publicationLabel)}</div>
                    <div class="cover-file">${escapeHtml(filename)}</div>
                    <div class="cover-meta">
                        <span class="cover-meta-count">${articleCount} 篇文章</span>
                        <span class="cover-meta-arrow">→</span>
                    </div>
                </div>
            </article>
        `;
    }

    function renderWall() {
        const grid = document.getElementById('cover-grid');
        const empty = document.getElementById('empty-state');
        const tabs = document.getElementById('publication-tabs');
        if (!grid || !empty) return;

        if (!INDEX.length) {
            grid.innerHTML = '';
            empty.hidden = false;
            setText('stat-issues', '0');
            setText('stat-articles', '0');
            return;
        }

        empty.hidden = true;
        const grouped = new Map();
        INDEX.forEach(issue => {
            const publication = issue.publication_type || 'General';
            const current = grouped.get(publication);
            if (!current || String(issue.publication_date || '') > String(current.publication_date || '')) {
                grouped.set(publication, issue);
            }
        });
        const publications = [...grouped.entries()].sort((a, b) => comparePublications(a[0], b[0]));
        const allIssues = [...INDEX].sort((a, b) => {
            const ad = new Date(a.publication_date || '').getTime() || 0;
            const bd = new Date(b.publication_date || '').getTime() || 0;
            if (bd !== ad) return bd - ad;
            return String(a.publication_type || '').localeCompare(String(b.publication_type || ''));
        });

        const publicationCodes = publications.map(([publication]) => publication);
        const urlPub = getPublicationFromUrl();
        const hasTypeParam = urlPub !== null;
        
        if (!publicationCodes.includes(state.currentPublication)) {
            // 优先级: URL参数 > localStorage > 最新日期
            const savedPub = getSavedPublication();
            state.currentPublication = (urlPub && publicationCodes.includes(urlPub)) ? urlPub
                : (savedPub && publicationCodes.includes(savedPub)) ? savedPub
                : [...publications]
                    .sort(([, leftLatest], [, rightLatest]) => String(rightLatest.publication_date || '').localeCompare(String(leftLatest.publication_date || '')))[0]?.[0]
                    || publicationCodes[0]
                    || null;
        }
        const selectedPublication = state.currentPublication;
        const issues = allIssues.filter(issue => (issue.publication_type || 'General') === selectedPublication);
        const articleCount = issues.reduce((sum, issue) => sum + (issue.article_count || 0), 0);

        // 根据是否有type参数决定是否显示tab区域
        const publicationSwitcher = document.querySelector('.publication-switcher');
        if (publicationSwitcher) {
            publicationSwitcher.style.display = hasTypeParam ? 'none' : '';
        }
        
        if (!hasTypeParam && tabs) {
            tabs.classList.toggle('is-many', publications.length > 3);
            tabs.style.setProperty('--publication-tab-columns', String(Math.min(publications.length, 3)));
            tabs.innerHTML = publications.map(([publication]) => {
                const count = INDEX.filter(issue => (issue.publication_type || 'General') === publication).length;
                const selected = publication === selectedPublication;
                return `<button class="publication-tab${selected ? ' is-active' : ''}" type="button" role="tab"
                    aria-selected="${selected}" tabindex="${selected ? '0' : '-1'}"
                    data-publication="${escapeHtml(publication)}"><span class="publication-tab-label">${escapeHtml(publicationName(publication))}</span><span class="publication-tab-count">${count} 期</span></button>`;
            }).join('');
            tabs.querySelectorAll('.publication-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    const publication = tab.dataset.publication || null;
                    
                    state.currentPublication = publication;
                    savePublication(state.currentPublication);
                    renderWall();
                });
            });
        }
        
        setText('wall-publication-title', publicationName(selectedPublication));
        setText('wall-publication-meta', hasTypeParam ? `${issues.length} 期 · ${articleCount} 篇文章` : `${issues.length} 期 · ${articleCount} 篇文章`);
        grid.innerHTML = issues.map(renderCoverCard).join('');
        grid.querySelectorAll('.cover-card').forEach(card => {
            card.addEventListener('click', () => {
                if (card.dataset.issueId) navigate(`/issue/${encodeURIComponent(card.dataset.issueId)}`);
            });
        });
        applyWallSearch();
    }

    function renderPublicationCard(publication, latest, issueCount, articleCount) {
        const dateLabel = formatDate(latest.publication_date);
        const cover = resolveIssueAsset(latest, latest.cover_image || '');
        const publicationLabel = publicationName(publication);
        return `
            <article class="cover-card publication-card" data-publication="${escapeHtml(publication)}"
                     data-search="${escapeHtml(`${publication} ${publicationLabel} ${dateLabel}`.toLowerCase())}">
                <div class="cover-image-wrap">
                    ${cover ? `<img class="cover-image" src="${escapeHtml(cover)}" alt="${escapeHtml(publicationLabel)} cover" loading="lazy">` : ''}
                    <div class="cover-image-fallback" ${cover ? 'hidden' : ''}>${escapeHtml(publication.slice(0, 3).toUpperCase())}</div>
                </div>
                <div class="cover-body">
                    <div class="cover-date">${escapeHtml(publicationLabel)}</div>
                    <div class="cover-id">最新一期 · ${escapeHtml(dateLabel)}</div>
                    <div class="cover-file">${issueCount} 期 · ${articleCount} 篇文章</div>
                    <div class="cover-meta"><span class="cover-meta-count">查看期刊</span><span class="cover-meta-arrow">→</span></div>
                </div>
            </article>`;
    }

    function renderPublication(publication) {
        const issues = INDEX.filter(issue => (issue.publication_type || 'General') === publication)
            .sort((a, b) => String(b.publication_date || '').localeCompare(String(a.publication_date || '')));
        setText('publication-title', publicationName(publication));
        setText('publication-meta', `${issues.length} 期 · ${issues.reduce((sum, issue) => sum + (issue.article_count || 0), 0)} 篇文章`);
        const grid = document.getElementById('issue-grid');
        const empty = document.getElementById('publication-empty');
        if (!grid || !empty) return;
        empty.hidden = issues.length > 0;
        grid.innerHTML = issues.map(renderCoverCard).join('');
        grid.querySelectorAll('.cover-card').forEach(card => {
            card.addEventListener('click', () => navigate(`/issue/${encodeURIComponent(card.dataset.issueId)}`));
        });
    }

    function loadIssueDatabase(issueId) {
        if (window.paper_databases && window.paper_databases[issueId]) {
            return Promise.resolve(window.paper_databases[issueId]);
        }
        const indexItem = INDEX.find(item => item.id === issueId);
        if (!indexItem) return Promise.reject(new Error(`Issue not found: ${issueId}`));

        const scriptId = `paper-db-${cssSafeId(issueId)}`;
        if (document.getElementById(scriptId)) {
            return waitForDatabase(issueId);
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.id = scriptId;
            const databaseVersion = indexItem.updated_at
                || indexItem.generated_at
                || indexItem.article_count
                || window.PAPER_FRONTEND_VERSION
                || '1';
            const separator = String(indexItem.database_path).includes('?') ? '&' : '?';
            script.src = databaseRoot(indexItem) + indexItem.database_path
                + separator + 'v=' + encodeURIComponent(databaseVersion);
            script.onload = () => {
                const db = window.paper_databases && window.paper_databases[issueId];
                db ? resolve(db) : reject(new Error(`Database loaded but missing id: ${issueId}`));
            };
            script.onerror = () => reject(new Error(`无法加载数据库：${script.src}`));
            document.body.appendChild(script);
        });
    }

    function waitForDatabase(issueId) {
        return new Promise((resolve, reject) => {
            let tries = 0;
            const timer = setInterval(() => {
                const db = window.paper_databases && window.paper_databases[issueId];
                if (db) {
                    clearInterval(timer);
                    resolve(db);
                } else if (++tries > 80) {
                    clearInterval(timer);
                    reject(new Error(`等待 database.js 超时：${issueId}`));
                }
            }, 50);
        });
    }

    function cssSafeId(value) {
        return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    function normalizeArticle(article, issue) {
        const id = article.id || `${issue.id}_article_${article.page || 0}_${article.page_article_index || 0}`;
        const category = article.category || article.section || 'General';
        return {
            ...article,
            id,
            category,
            section: category,
            print_page_label: normalizedLabel(article.print_page_label),
            print_section: normalizedLabel(article.print_section),
            source_pages: uniquePositiveNumbers(article.source_pages),
            title: article.title || 'Untitled',
            title_zh: article.title_zh || '',
            images: Array.isArray(article.images) ? article.images : [],
            image_insights: Array.isArray(article.image_insights) ? article.image_insights : [],
            term_annotations: Array.isArray(article.term_annotations) ? article.term_annotations : [],
            paragraphs: normalizeParagraphs(article, id),
        };
    }

    function normalizedLabel(value) {
        if (value === null || value === undefined) return null;
        const normalized = String(value).trim();
        return normalized || null;
    }

    function uniqueStrings(values) {
        const seen = new Set();
        return (values || []).map(value => String(value || '').trim()).filter(value => {
            if (!value || seen.has(value)) return false;
            seen.add(value);
            return true;
        });
    }

    function uniquePositiveNumbers(values) {
        const seen = new Set();
        return (Array.isArray(values) ? values : []).map(Number).filter(value => {
            if (!Number.isInteger(value) || value <= 0 || seen.has(value)) return false;
            seen.add(value);
            return true;
        });
    }

    function compareArticlePosition(left, right) {
        return Number(left.page_article_index || 0) - Number(right.page_article_index || 0)
            || String(left.id).localeCompare(String(right.id));
    }

    function usesCategoryArticleToc(issue) {
        return String(issue && issue.publication_type || '').toUpperCase() === 'TE';
    }

    function normalizeIssueLayout(issue) {
        if (usesCategoryArticleToc(issue)) {
            issue.pages = [];
            issue.front_page = null;
            return issue;
        }

        const articleById = new Map(issue.articles.map(article => [article.id, article]));
        let pages = (Array.isArray(issue.pages) ? issue.pages : []).map((page, index) => ({
            ...page,
            pdf_page: Number(page.pdf_page || page.page || 0) || null,
            page_order: Number(page.page_order || 0) || index + 1,
            print_page_label: normalizedLabel(page.print_page_label),
            print_section: normalizedLabel(page.print_section),
            article_ids: uniqueStrings(page.article_ids).filter(id => articleById.has(id)),
        })).sort((left, right) => left.page_order - right.page_order || (left.pdf_page || 0) - (right.pdf_page || 0));

        if (!pages.length) {
            const grouped = new Map();
            issue.articles.forEach(article => {
                const pdfPage = Number(article.page || 0) || null;
                const label = normalizedLabel(article.print_page_label);
                const section = normalizedLabel(article.print_section);
                const key = `${label || ''}\u0000${section || ''}\u0000${pdfPage || ''}`;
                if (!grouped.has(key)) {
                    grouped.set(key, {
                        pdf_page: pdfPage,
                        page_order: grouped.size + 1,
                        print_page_label: label,
                        print_section: section,
                        article_ids: [],
                        is_fallback: true,
                    });
                }
                grouped.get(key).article_ids.push(article.id);
            });
            pages = Array.from(grouped.values());
        }

        issue.articles.forEach(article => {
            const sourcePages = uniquePositiveNumbers([
                ...(article.source_pages || []),
                article.page,
            ]);
            sourcePages.forEach(pdfPage => {
                const matchingPage = pages.find(page => page.pdf_page === pdfPage);
                if (matchingPage) matchingPage.article_ids.push(article.id);
            });
        });

        const referenced = new Set(pages.flatMap(page => page.article_ids));
        issue.articles.forEach(article => {
            if (referenced.has(article.id)) return;
            const matchingPage = pages.find(page => (
                article.print_page_label && page.print_page_label
                && samePageLabel(article.print_page_label, page.print_page_label)
            )) || pages.find(page => Number(article.page || 0) && Number(article.page) === page.pdf_page);
            if (matchingPage) {
                matchingPage.article_ids.push(article.id);
                referenced.add(article.id);
            }
        });

        const unmatchedArticleIds = issue.articles
            .filter(article => !referenced.has(article.id))
            .map(article => article.id);
        if (unmatchedArticleIds.length) {
            pages.push({
                pdf_page: null,
                page_order: pages.reduce((max, page) => Math.max(max, page.page_order || 0), 0) + 1,
                print_page_label: null,
                print_section: null,
                article_ids: unmatchedArticleIds,
                is_fallback: true,
            });
            unmatchedArticleIds.forEach(id => referenced.add(id));
        }

        pages.forEach(page => {
            page.article_ids = uniqueStrings(page.article_ids).sort((leftId, rightId) => (
                compareArticlePosition(articleById.get(leftId), articleById.get(rightId))
            ));
            page.article_ids.forEach(id => {
                const article = articleById.get(id);
                if (!article) return;
                if (!article.print_page_label) article.print_page_label = page.print_page_label;
                if (!article.print_section) article.print_section = page.print_section;
            });
        });

        const ordered = [];
        const orderedIds = new Set();
        pages.forEach(page => page.article_ids.forEach(id => {
            if (orderedIds.has(id) || !articleById.has(id)) return;
            orderedIds.add(id);
            ordered.push(articleById.get(id));
        }));
        issue.articles.slice().sort((left, right) => (
            Number(left.page || 0) - Number(right.page || 0) || compareArticlePosition(left, right)
        )).forEach(article => {
            if (!orderedIds.has(article.id)) ordered.push(article);
        });

        issue.pages = pages;
        issue.articles = ordered;
        issue.front_page = normalizeFrontPage(issue.front_page);
        return issue;
    }

    function normalizeFrontPage(frontPage) {
        if (!frontPage || typeof frontPage !== 'object' || Array.isArray(frontPage)) return null;
        const whatsNews = frontPage.whats_news && typeof frontPage.whats_news === 'object'
            ? frontPage.whats_news : {};
        const groups = (Array.isArray(whatsNews.groups) ? whatsNews.groups : []).map(group => ({
            name: String(group.name || '').trim() || 'What’s News',
            items: (Array.isArray(group.items) ? group.items : []).map(item => ({
                text: String(item.text || item.title || '').trim(),
                title: String(item.title || '').trim(),
                title_zh: String(item.title_zh || '').trim(),
                target_article_id: String(item.target_article_id || '').trim() || null,
                target_print_page_label: String(item.target_print_page_label || '').trim() || null,
            })).filter(item => item.text),
        })).filter(group => group.items.length);
        if (!groups.length) return null;
        return {
            ...frontPage,
            pdf_page: Number(frontPage.pdf_page || frontPage.page || 0) || null,
            print_page_label: normalizedLabel(frontPage.print_page_label),
            print_section: normalizedLabel(frontPage.print_section),
            directory_name: String(frontPage.directory_name || '').trim() || null,
            whats_news: { ...whatsNews, groups },
        };
    }

    function normalizeParagraphs(article, articleId) {
        if (Array.isArray(article.paragraphs) && article.paragraphs.length) {
            return article.paragraphs.map((paragraph, index) => ({
                para_id: paragraph.para_id || `${articleId}_p${index + 1}`,
                zh_text: paragraph.zh_text || '',
                en_text: paragraph.en_text || paragraph.en_html || '',
                role: paragraph.role || 'body',
            })).filter(p => p.zh_text || p.en_text);
        }
        const content = article.content_markdown || article.content_raw || '';
        return String(content)
            .split(/\n\s*\n/)
            .map(part => part.trim())
            .filter(Boolean)
            .map((part, index) => ({
                para_id: `${articleId}_p${index + 1}`,
                zh_text: '',
                en_text: part,
                role: 'body',
            }));
    }

    function pageLabel(page) {
        return normalizedLabel(page && page.print_page_label)
            || (Number(page && page.pdf_page) ? `PDF ${Number(page.pdf_page)}` : 'PDF 页码未知');
    }

    function displayPrintSection(value) {
        const raw = normalizedLabel(value);
        if (!raw) return null;
        const key = raw.replace(/\s+/g, ' ').toLocaleUpperCase('en-US');
        if (PRINT_SECTION_DISPLAY_NAMES[key]) return PRINT_SECTION_DISPLAY_NAMES[key];
        if (raw !== key || !/[A-Z]/.test(raw)) return raw;
        const smallWords = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
        const acronyms = new Set(['AI', 'CEO', 'CFO', 'EU', 'UK', 'U.K.']);
        return key.toLocaleLowerCase('en-US').split(' ').map((word, index) => {
            const upper = word.toLocaleUpperCase('en-US');
            if (acronyms.has(upper)) return upper;
            if (index > 0 && smallWords.has(word)) return word;
            return word.replace(/[a-z]/, letter => letter.toLocaleUpperCase('en-US'));
        }).join(' ');
    }

    function whatsNewsTokens(value) {
        const normalized = String(value || '')
            .toLocaleLowerCase('en-US')
            .replace(/([a-z])-\s+([a-z])/g, '$1$2');
        return new Set((normalized.match(/[a-z0-9]+/g) || []).map(token => {
            if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
            if (token.length > 4 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
            return token;
        }).filter(token => token.length >= 3 && !WHATS_NEWS_STOP_WORDS.has(token)));
    }

    function whatsNewsMatchScore(item, article) {
        const queryTokens = whatsNewsTokens(item.text);
        if (!queryTokens.size) return 0;
        const titleTokens = whatsNewsTokens(article.title);
        const bodyTokens = whatsNewsTokens(
            article.content_markdown || article.content_raw
            || (article.paragraphs || []).map(paragraph => paragraph.en_text || '').join(' ')
        );
        let titleOverlap = 0;
        let bodyOverlap = 0;
        queryTokens.forEach(token => {
            if (titleTokens.has(token)) titleOverlap += 1;
            if (bodyTokens.has(token)) bodyOverlap += 1;
        });
        if (!titleOverlap && bodyOverlap < 3) return 0;
        return titleOverlap * 7 + bodyOverlap;
    }

    function resolveWhatsNewsArticle(issue, item, usedArticleIds) {
        const explicit = item.target_article_id
            ? issue.articles.find(article => article.id === item.target_article_id) : null;
        if (explicit) return explicit;
        const targetPage = item.target_print_page_label
            ? findPrintPage(issue, item.target_print_page_label) : null;
        const candidates = articlesForPage(issue, targetPage)
            .filter(article => !usedArticleIds.has(article.id));
        if (candidates.length === 1) return candidates[0];
        const scored = candidates.map(article => ({
            article,
            score: whatsNewsMatchScore(item, article),
        })).sort((left, right) => right.score - left.score);
        return scored.length && scored[0].score >= 3 ? scored[0].article : null;
    }

    function renderWhatsNewsGroupHeading(name) {
        const english = String(name || 'What’s News').trim() || 'What’s News';
        const chinese = WHATS_NEWS_GROUP_NAMES[english.toLocaleUpperCase('en-US')];
        return chinese
            ? `<h2><span>${escapeHtml(chinese)}</span><small>${escapeHtml(english)}</small></h2>`
            : `<h2>${escapeHtml(english)}</h2>`;
    }

    function renderWhatsNewsCopy(item, targetArticle) {
        const title = item.title || (targetArticle && targetArticle.title) || '';
        const titleZh = item.title_zh || (targetArticle && targetArticle.title_zh) || '';
        if (!title) {
            return `<span class="whats-news-summary is-primary">${escapeHtml(item.text)}</span>`;
        }
        return `<span class="whats-news-copy">
            <strong>${escapeHtml(titleZh || title)}</strong>
            ${titleZh ? `<em>${escapeHtml(title)}</em>` : ''}
            ${item.text !== title ? `<span class="whats-news-summary">${escapeHtml(item.text)}</span>` : ''}
        </span>`;
    }

    function pageHeading(page) {
        return `${pageLabel(page)} · ${displayPrintSection(page && page.print_section) || '栏目未识别'}`;
    }

    function renderArticleItem(article, primaryMembership) {
        const active = primaryMembership && state.currentIssueView === 'article'
            && article.id === state.currentArticleId;
        const searchText = [
            article.title_zh,
            article.title,
            article.print_page_label,
            article.print_section,
            article.category,
            article.summary_md,
            article.content_markdown,
        ].join(' ');
        return `
            <button class="article-item${active ? ' is-active' : ''}" data-article-id="${escapeHtml(article.id)}"
                    ${primaryMembership ? 'data-primary-membership="true"' : ''}
                    ${active ? 'aria-current="true"' : ''}
                    data-search-title="${escapeHtml(searchText.toLowerCase())}">
                <div class="article-item-title-zh">${escapeHtml(article.title_zh || article.title)}</div>
                <div class="article-item-title-en">${escapeHtml(article.title)}</div>
                <span class="article-match-badge" data-match-info></span>
            </button>
        `;
    }

    function isFrontPage(issue, page) {
        if (!issue.front_page || !page) return false;
        const frontLabel = normalizedLabel(issue.front_page.print_page_label);
        if (frontLabel && samePageLabel(frontLabel, page.print_page_label)) return true;
        const frontPdfPage = Number(issue.front_page.pdf_page || 0);
        return !frontLabel && frontPdfPage > 0 && frontPdfPage === Number(page.pdf_page || 0);
    }

    function primaryPageForArticle(issue, article) {
        if (!issue || !article) return null;
        const pages = Array.isArray(issue.pages) ? issue.pages : [];
        const printPageLabel = normalizedLabel(article.print_page_label);
        if (printPageLabel) {
            const labelMatch = pages.find(page => samePageLabel(page.print_page_label, printPageLabel));
            if (labelMatch) return labelMatch;
        }
        const pdfPage = Number(article.pdf_page || article.page || 0);
        if (pdfPage > 0) {
            const pdfMatch = pages.find(page => Number(page.pdf_page || 0) === pdfPage);
            if (pdfMatch) return pdfMatch;
        }
        return pages.find(page => (page.article_ids || []).includes(article.id)) || null;
    }

    function renderArticleList(issue) {
        if (usesCategoryArticleToc(issue)) {
            const groups = new Map();
            issue.articles.forEach(article => {
                const category = String(article.category || 'General').trim() || 'General';
                if (!groups.has(category)) groups.set(category, []);
                groups.get(category).push(article);
            });
            return Array.from(groups.entries()).map(([category, articles]) => {
                const active = state.currentIssueView === 'article'
                    && articles.some(article => article.id === state.currentArticleId);
                return `<div class="article-group article-group-category${active ? ' is-active' : ''}"
                            data-category="${escapeHtml(category)}">
                    <div class="article-group-header article-category-header${active ? ' is-active' : ''}"
                         role="heading" aria-level="3"
                         data-search-title="${escapeHtml(category.toLowerCase())}">
                        <span>${escapeHtml(category)}</span>
                        <span class="article-group-count">${articles.length}</span>
                    </div>
                    ${articles.map(article => renderArticleItem(article, true)).join('')}
                </div>`;
            }).join('');
        }

        const primaryPages = new Map(issue.articles.map(article => (
            [article.id, primaryPageForArticle(issue, article)]
        )));
        return issue.pages.map(page => {
            const seenOnPage = new Set();
            const items = page.article_ids.map(id => issue.articles.find(article => article.id === id))
                .filter(article => {
                    if (!article || seenOnPage.has(article.id)) return false;
                    seenOnPage.add(article.id);
                    return true;
                });
            const frontPage = isFrontPage(issue, page);
            const activeArticle = state.currentIssueView === 'article'
                ? items.find(article => (
                    article.id === state.currentArticleId && primaryPages.get(article.id) === page
                ))
                : null;
            const active = (frontPage && state.currentIssueView === 'frontpage')
                || (state.currentIssueView === 'page' && samePageLabel(state.currentPageLabel, pageLabel(page)))
                || !!activeArticle;
            return `
            <div class="article-group${active ? ' is-active' : ''}" data-page-label="${escapeHtml(pageLabel(page))}">
                <button class="article-group-header${active ? ' is-active' : ''}"
                        ${active ? 'aria-current="page"' : ''}
                        type="button" ${frontPage ? 'data-frontpage' : `data-page-link="${escapeHtml(pageLabel(page))}"`}
                        data-search-title="${escapeHtml(pageHeading(page).toLowerCase())}">
                    <span>${escapeHtml(pageHeading(page))}</span>
                    <span class="article-group-count">${items.length}</span>
                </button>
                ${items.map(article => renderArticleItem(
                    article,
                    primaryPages.get(article.id) === page,
                )).join('')}
            </div>
        `;
        }).join('');
    }

    function samePageLabel(left, right) {
        const normalizedLeft = normalizedLabel(left);
        const normalizedRight = normalizedLabel(right);
        return !!normalizedLeft && !!normalizedRight
            && normalizedLeft.toLocaleUpperCase() === normalizedRight.toLocaleUpperCase();
    }

    function renderIssue(issueId, routeState) {
        const indexItem = INDEX.find(item => item.id === issueId);
        if (!indexItem) {
            navigate('/');
            return;
        }

        activateIssueSearch(issueId);

        const loadToken = ++state.issueLoadToken;
        const requestedHash = window.location.hash;
        const isCurrentLoad = () => (
            loadToken === state.issueLoadToken && window.location.hash === requestedHash
        );
        stopTts();
        showArticleReader(true);

        setText('issue-id-label', publicationName(indexItem.publication_type || indexItem.id));
        setText('issue-date-label', formatDate(indexItem.publication_date));
        setText('article-count', '加载中');
        setText('current-section', 'Loading');
        setText('current-category', '');
        setText('current-title-zh', '正在加载数据库...');
        setText('current-title-en', displayFilename(indexItem.original_filename));
        setHtml('summary-content', '<p>正在读取本期 database.js。</p>');
        setHtml('bilingual-grid', '');

        loadIssueDatabase(issueId)
            .then(db => {
                if (!isCurrentLoad()) return;
                const issue = { ...indexItem, ...db };
                issue.database_path = indexItem.database_path || issue.database_path;
                issue.database_root = indexItem.database_root || issue.database_root || DATABASE_ROOT;
                issue.glossary = issue.glossary && typeof issue.glossary === 'object'
                    ? issue.glossary
                    : {};
                issue.articles = (issue.articles || []).map(article => normalizeArticle(article, issue));
                normalizeIssueLayout(issue);
                state.currentIssueId = issueId;
                state.currentIssue = issue;
                state.currentArticles = issue.articles;
                renderLoadedIssue(issue, routeState || {});
            })
            .catch(error => {
                if (!isCurrentLoad()) return;
                console.error(error);
                showArticleReader(true);
                setText('current-section', 'Error');
                setText('current-title-zh', '数据库加载失败');
                setText('current-title-en', error.message);
                setHtml('summary-content', `<p>${escapeHtml(error.message)}</p>`);
            });
    }

    function renderLoadedIssue(issue, routeState) {
        const articleCount = issue.articles.length;
        setText('issue-id-label', publicationName(issue.publication_type || issue.id));
        setText('issue-date-label', `${formatDate(issue.publication_date)} · ${displayFilename(issue.original_filename)}`);
        setText('article-count', `${articleCount} 篇`);
        setText('article-bottom-toc-count', `本期共 ${articleCount} 篇文章`);

        const requestedView = routeState.view;
        if (!requestedView) {
            const defaultPath = issue.front_page
                ? `/issue/${encodeURIComponent(issue.id)}/frontpage`
                : issue.articles[0]
                    ? `/issue/${encodeURIComponent(issue.id)}/${encodeURIComponent(issue.articles[0].id)}`
                    : null;
            if (defaultPath) {
                navigate(defaultPath, true);
                return;
            }
        }

        state.currentIssueView = requestedView || 'page';
        state.currentPageLabel = routeState.pageLabel || null;
        state.currentArticleId = routeState.articleId || null;
        renderIssueNavigation(issue);

        if (requestedView === 'frontpage') {
            issue.front_page ? renderFrontPage(issue) : renderUnavailableFrontPage();
        } else if (requestedView === 'page') {
            renderPrintPage(issue, routeState.pageLabel);
        } else {
            let target = routeState.articleId
                ? issue.articles.find(article => article.id === routeState.articleId)
                : null;
            if (!target && issue.articles.length) target = issue.articles[0];
            if (target) {
                state.currentIssueView = 'article';
            state.currentArticleId = target.id;
            renderArticle(target, issue);
                if (routeState.articleId && routeState.articleId !== target.id) {
                navigate(`/issue/${encodeURIComponent(issue.id)}/${encodeURIComponent(target.id)}`, true);
                    return;
                }
            } else {
                renderNoArticle(issue);
            }
        }

        highlightCurrentArticle();
        applyNavSearch();
        scrollDocumentToTop();
    }

    function renderNoArticle(issue) {
        showArticleReader(true);
        setText('current-section', publicationName(issue.publication_type || 'General'));
        setText('current-category', '');
        setText('current-title-zh', '本期暂无文章');
        setText('current-title-en', displayFilename(issue.original_filename));
        setHtml('summary-content', '<p>当前 database.js 中没有可展示文章。</p>');
        setHtml('bilingual-grid', '<p class="bilingual-empty">暂无正文。</p>');
    }

    function renderArticle(article, issue) {
        closeGlossaryUi(false);
        showArticleReader(true);
        const printHeading = usesCategoryArticleToc(issue)
            ? ''
            : [article.print_page_label, displayPrintSection(article.print_section)].filter(Boolean).join(' · ');
        setText('current-section', printHeading || (
            usesCategoryArticleToc(issue) ? publicationName(issue.publication_type) : '版面信息未知'
        ));
        setText('current-category', article.category || '');
        setText('current-title-zh', article.title_zh || article.title || '');
        setText('current-title-en', article.title || '');

        const summary = article.summary_md || buildLocalSummary(article);
        setHtml('summary-content', renderMarkdown(summary, issue));
        renderBilingual(article, issue);
        bindImageZoom(article, issue);
        updateArticleNavigation();
    }

    function showArticleReader(show) {
        document.getElementById('article-reader').hidden = !show;
        document.getElementById('issue-overview').hidden = show;
    }

    function renderIssueNavigation(issue) {
        const list = document.getElementById('article-list');
        list.innerHTML = renderArticleList(issue);
        bindIssueLinks(list, issue, false);
    }

    function bindIssueLinks(root, issue, closeSheet) {
        root.querySelectorAll('[data-frontpage]').forEach(item => {
            item.addEventListener('click', () => {
                if (closeSheet) closeTocSheet();
                navigate(`/issue/${encodeURIComponent(issue.id)}/frontpage`);
            });
        });
        root.querySelectorAll('[data-page-link]').forEach(item => {
            item.addEventListener('click', () => {
                if (closeSheet) closeTocSheet();
                navigate(`/issue/${encodeURIComponent(issue.id)}/page/${encodeURIComponent(item.dataset.pageLink)}`);
            });
        });
        root.querySelectorAll('[data-article-id]').forEach(item => {
            item.addEventListener('click', () => {
                if (closeSheet) closeTocSheet();
                if (item.dataset.articleId) {
                    navigate(`/issue/${encodeURIComponent(issue.id)}/${encodeURIComponent(item.dataset.articleId)}`);
                }
            });
        });
    }

    function findPrintPage(issue, label) {
        const direct = issue.pages.find(page => samePageLabel(pageLabel(page), label)) || null;
        if (direct) return direct;
        const numericLabel = String(label || '').trim();
        if (
            String(issue.publication_type || '').toUpperCase() === 'FT'
            && /^\d+$/.test(numericLabel)
        ) {
            return issue.pages.find(page => Number(page.pdf_page || 0) === Number(numericLabel)) || null;
        }
        return null;
    }

    function articlesForPage(issue, page) {
        if (!page) return [];
        const byId = new Map(issue.articles.map(article => [article.id, article]));
        return uniqueStrings(page.article_ids).map(id => byId.get(id)).filter(Boolean);
    }

    function renderOverviewArticleList(articles, emptyText) {
        if (!articles.length) return `<p class="issue-overview-empty">${escapeHtml(emptyText)}</p>`;
        return `<div class="issue-overview-articles">${articles.map(article => `
            <button class="issue-overview-article" type="button" data-article-id="${escapeHtml(article.id)}">
                <strong>${escapeHtml(article.title_zh || article.title)}</strong>
                ${article.title_zh ? `<span>${escapeHtml(article.title)}</span>` : ''}
            </button>`).join('')}</div>`;
    }

    function renderFrontPage(issue) {
        stopTts();
        showArticleReader(false);
        state.currentArticleId = null;
        const overview = document.getElementById('issue-overview');
        const label = issue.front_page.print_page_label || '';
        const page = issue.pages.find(candidate => isFrontPage(issue, candidate)) || null;
        const groups = issue.front_page.whats_news.groups;
        const directoryName = issue.front_page.directory_name
            || (String(issue.publication_type || '').toUpperCase() === 'FT' ? 'Briefing' : 'What’s News');
        const usedWhatsNewsArticleIds = new Set();
        overview.innerHTML = `
            <header class="issue-overview-header">
                <span class="issue-overview-kicker">${escapeHtml([label, displayPrintSection(issue.front_page.print_section)].filter(Boolean).join(' · '))}</span>
                <h1>今日头版</h1><p>${escapeHtml(directoryName)}</p>
            </header>
            <section class="frontpage-leads">
                <h2>${escapeHtml(label || '头版')}文章</h2>
                ${renderOverviewArticleList(articlesForPage(issue, page), '当前数据中没有可用的头版文章。')}
            </section>
            <section class="whats-news" aria-label="${escapeHtml(directoryName)}">
                ${groups.map(group => `<div class="whats-news-group">${renderWhatsNewsGroupHeading(group.name)}<ul>${group.items.map(item => {
                    const targetArticle = resolveWhatsNewsArticle(issue, item, usedWhatsNewsArticleIds);
                    if (targetArticle) usedWhatsNewsArticleIds.add(targetArticle.id);
                    const targetPage = item.target_print_page_label
                        ? findPrintPage(issue, item.target_print_page_label) : null;
                    const available = !!(targetArticle || targetPage);
                    const targetLabel = targetArticle
                        ? (targetArticle.print_page_label || '阅读文章')
                        : targetPage ? pageLabel(targetPage) : (item.target_print_page_label || '目标不可用');
                    return `<li><button type="button" ${available ? '' : 'disabled'}
                        ${targetArticle ? `data-article-id="${escapeHtml(targetArticle.id)}"` : ''}
                        ${!targetArticle && targetPage ? `data-page-link="${escapeHtml(pageLabel(targetPage))}"` : ''}>
                        ${renderWhatsNewsCopy(item, targetArticle)}<small>${escapeHtml(targetLabel)}</small>
                    </button></li>`;
                }).join('')}</ul></div>`).join('')}
            </section>`;
        bindIssueLinks(overview, issue, false);
        updateArticleNavigation();
    }

    function renderUnavailableFrontPage() {
        stopTts();
        showArticleReader(false);
        state.currentArticleId = null;
        document.getElementById('issue-overview').innerHTML = `
            <header class="issue-overview-header"><span class="issue-overview-kicker">头版不可用</span><h1>今日头版</h1></header>
            <p class="issue-overview-empty">本期没有可用的头版目录数据，未自动生成或推测目录。</p>`;
        updateArticleNavigation();
    }

    function renderPrintPage(issue, label) {
        stopTts();
        showArticleReader(false);
        state.currentArticleId = null;
        const overview = document.getElementById('issue-overview');
        const page = findPrintPage(issue, label);
        if (!page) {
            overview.innerHTML = `<header class="issue-overview-header"><span class="issue-overview-kicker">版面不可用</span><h1>${escapeHtml(label || '未知版面')}</h1></header><p class="issue-overview-empty">本期数据中没有这个版面，未自动跳转到其他内容。</p>`;
            updateArticleNavigation();
            return;
        }
        overview.innerHTML = `<header class="issue-overview-header"><span class="issue-overview-kicker">纸质版面</span><h1>${escapeHtml(pageLabel(page))}</h1><p>${escapeHtml(displayPrintSection(page.print_section) || '栏目未标注')}</p></header><section class="print-page-articles"><h2>本版文章</h2>${renderOverviewArticleList(articlesForPage(issue, page), '当前数据中没有可用文章。')}</section>`;
        bindIssueLinks(overview, issue, false);
        updateArticleNavigation();
    }

    function buildLocalSummary(article) {
        const words = String(article.content_markdown || '').split(/\s+/).filter(Boolean).length;
        return [
            '### 基本信息',
            `- 版面：${[article.print_page_label, article.print_section].filter(Boolean).join(' · ') || '未知'}`,
            `- 分类：${article.category || 'General'}`,
            `- PDF 页码：${article.page || '未知'}`,
            `- 正文字数：约 ${words} words`,
            '',
            '### 处理状态',
            article.compiled_article ? '- 已完成 LLM 结构化编译。' : '- 当前文章使用本地段落整理，暂无中文深度解读。',
        ].join('\n');
    }

    function renderImageGallery(article, issue) {
        const images = (article.images || []).map(path => ({
            path: resolveIssueAsset(issue, path),
            caption: article.title || '',
        }));
        return images;
    }

    function renderBilingual(article, issue) {
        const grid = document.getElementById('bilingual-grid');
        const paragraphs = article.paragraphs || [];
        if (!paragraphs.length) {
            grid.innerHTML = '<p class="bilingual-empty">该文章暂无段落内容。</p>';
            return;
        }

        const imageMarkup = renderArticleImages(article, issue);
        grid.innerHTML = imageMarkup + paragraphs.map((paragraph, index) => {
            const zh = paragraph.zh_text
                ? renderMarkdown(paragraph.zh_text, issue)
                : '<span class="text-muted">暂无中文翻译</span>';
            const en = paragraph.en_text
                ? renderMarkdown(paragraph.en_text, issue)
                : '';
            return `
                <div class="bilingual-pair" data-para-id="${escapeHtml(paragraph.para_id || '')}"
                     data-paragraph-index="${index + 1}">
                    <div class="bilingual-pair-en">${en}</div>
                    <div class="bilingual-pair-zh">${zh}</div>
                </div>
            `;
        }).join('');
        applyGlossaryAnnotations(grid, article, issue);
    }

    function renderArticleImages(article, issue) {
        const insights = article.image_insights || [];
        const insightByPath = new Map(insights.map(item => [String(item.path || ''), item]));
        const images = (article.images || []).map(path => ({
            path: resolveIssueAsset(issue, path),
            rawPath: path,
            insight: insightByPath.get(String(path)) || null,
        }));
        if (!images.length) return '';
        return `<div class="article-image-analysis"><div class="article-image-analysis-title">图片与图表</div><div class="article-image-grid">${images.map((image, index) => {
            const insight = image.insight || {};
            const caption = insight.description || article.title || '';
            const kind = insight.image_type === 'chart' ? '📊 图表' : '图片';
            return `<figure class="article-image-item" data-image-index="${index}"><img src="${escapeHtml(image.path)}" alt="${escapeHtml(caption)}" loading="lazy"><figcaption><span class="article-image-kind">${kind}</span>${escapeHtml(caption)}</figcaption></figure>`;
        }).join('')}</div></div>`;
    }

    function applyGlossaryAnnotations(grid, article, issue) {
        const glossary = issue.glossary || {};
        const annotations = (article.term_annotations || [])
            .filter(annotation => annotation && annotation.text_field === 'zh_text' && glossary[annotation.glossary_id])
            .slice()
            .sort((left, right) => {
                const pageOrder = Number(left.paragraph_index || 0) - Number(right.paragraph_index || 0);
                if (pageOrder) return pageOrder;
                return String(right.surface || '').length - String(left.surface || '').length;
            });

        let appliedCount = 0;
        const missed = [];
        annotations.forEach(annotation => {
            const paragraphIndex = Number(annotation.paragraph_index || 0);
            const textField = 'zh_text';
            const surface = String(annotation.surface || '').trim();
            const occurrence = Math.max(Number(annotation.occurrence || 1), 1);
            const entry = glossary[annotation.glossary_id];
            if (!paragraphIndex || !surface || !entry || !entry.description_zh) return;
            const columnClass = '.bilingual-pair-zh';
            const column = grid.querySelector(
                `.bilingual-pair[data-paragraph-index="${paragraphIndex}"] ${columnClass}`
            );
            if (!column) {
                missed.push({ surface, paragraphIndex, textField, reason: 'paragraph-not-found' });
                return;
            }
            const button = wrapTextOccurrence(column, surface, occurrence);
            if (!button) {
                missed.push({ surface, paragraphIndex, textField, reason: 'surface-not-found' });
                return;
            }
            button.dataset.glossaryId = annotation.glossary_id;
            button.dataset.textField = textField;
            button.setAttribute('aria-label', `${surface}，查看解释`);
            button.setAttribute('aria-expanded', 'false');
            bindGlossaryTerm(button, entry);
            appliedCount += 1;
        });
        grid.dataset.glossaryAnnotations = String(annotations.length);
        grid.dataset.glossaryTerms = String(appliedCount);
        if (missed.length) {
            console.warn(
                `术语标注有 ${missed.length} 项未能匹配正文：${article.title || article.id || ''}`,
                missed
            );
        }
    }

    function wrapTextOccurrence(root, surface, requestedOccurrence) {
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                    const parent = node.parentElement;
                    if (!parent || parent.closest('a, button, code, pre, script, style')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                },
            }
        );
        let remaining = requestedOccurrence;
        while (walker.nextNode()) {
            const node = walker.currentNode;
            const positions = findTermPositions(node.nodeValue, surface);
            if (positions.length < remaining) {
                remaining -= positions.length;
                continue;
            }
            const start = positions[remaining - 1];
            const actualText = node.nodeValue.slice(start, start + surface.length);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'glossary-term';
            button.textContent = actualText;
            const before = document.createTextNode(node.nodeValue.slice(0, start));
            const after = document.createTextNode(node.nodeValue.slice(start + surface.length));
            node.replaceWith(before, button, after);
            return button;
        }
        return null;
    }

    function findTermPositions(text, surface) {
        const positions = [];
        const source = String(text || '');
        const query = String(surface || '');
        if (!source || !query) return positions;
        const sourceLower = source.toLocaleLowerCase('en-US');
        const queryLower = query.toLocaleLowerCase('en-US');
        let start = 0;
        while (start <= sourceLower.length - queryLower.length) {
            const index = sourceLower.indexOf(queryLower, start);
            if (index < 0) break;
            if (hasTermBoundaries(source, index, query.length)) positions.push(index);
            start = index + Math.max(query.length, 1);
        }
        return positions;
    }

    function hasTermBoundaries(text, start, length) {
        const before = start > 0 ? text[start - 1] : '';
        const after = start + length < text.length ? text[start + length] : '';
        const first = text[start] || '';
        const last = text[start + length - 1] || '';
        const word = character => /[A-Za-z0-9_]/.test(character);
        if (word(first) && word(before)) return false;
        if (word(last) && word(after)) return false;
        return true;
    }

    function bindGlossaryTerm(button, entry) {
        button.addEventListener('mouseenter', () => {
            if (usesGlossarySheet()) return;
            cancelGlossaryHide();
            showGlossaryPopover(button, entry, false);
        });
        button.addEventListener('mouseleave', scheduleGlossaryHide);
        button.addEventListener('focus', () => {
            if (usesGlossarySheet()) return;
            cancelGlossaryHide();
            showGlossaryPopover(button, entry, false);
        });
        button.addEventListener('blur', scheduleGlossaryHide);
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (usesGlossarySheet()) {
                openGlossarySheet(button, entry);
                return;
            }
            if (glossaryUiState.activeButton === button && glossaryUiState.pinned) {
                closeGlossaryPopover(true);
                return;
            }
            showGlossaryPopover(button, entry, true);
        });
    }

    function usesGlossarySheet() {
        return window.matchMedia(
            '(max-width: 720px), (hover: none), (pointer: coarse)'
        ).matches;
    }

    function showGlossaryPopover(button, entry, pinned) {
        const popover = document.getElementById('glossary-popover');
        if (!popover) return;
        closeGlossarySheet(false);
        if (glossaryUiState.activeButton && glossaryUiState.activeButton !== button) {
            glossaryUiState.activeButton.setAttribute('aria-expanded', 'false');
        }
        glossaryUiState.activeButton = button;
        glossaryUiState.pinned = pinned;
        button.setAttribute('aria-expanded', 'true');
        button.setAttribute('aria-describedby', 'glossary-popover');
        setGlossaryContent('glossary-popover', entry);
        popover.hidden = false;
        positionGlossaryPopover(button, popover);
    }

    function positionGlossaryPopover(button, popover) {
        const anchor = button.getBoundingClientRect();
        const box = popover.getBoundingClientRect();
        const gap = 10;
        const margin = 12;
        let left = anchor.left + anchor.width / 2 - box.width / 2;
        left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));
        let top = anchor.bottom + gap;
        if (top + box.height > window.innerHeight - margin) {
            top = Math.max(margin, anchor.top - box.height - gap);
        }
        popover.style.left = `${Math.round(left)}px`;
        popover.style.top = `${Math.round(top)}px`;
    }

    function scheduleGlossaryHide() {
        cancelGlossaryHide();
        glossaryUiState.hideTimer = window.setTimeout(() => {
            if (glossaryUiState.pinned) return;
            if (document.activeElement === glossaryUiState.activeButton) return;
            closeGlossaryPopover(true);
        }, 140);
    }

    function cancelGlossaryHide() {
        if (glossaryUiState.hideTimer) {
            window.clearTimeout(glossaryUiState.hideTimer);
            glossaryUiState.hideTimer = null;
        }
    }

    function closeGlossaryPopover(force) {
        if (glossaryUiState.pinned && !force) return;
        cancelGlossaryHide();
        const popover = document.getElementById('glossary-popover');
        const wasOpen = Boolean(popover && !popover.hidden);
        if (popover) popover.hidden = true;
        if (!wasOpen) {
            glossaryUiState.pinned = false;
            return;
        }
        if (glossaryUiState.activeButton) {
            glossaryUiState.activeButton.setAttribute('aria-expanded', 'false');
            glossaryUiState.activeButton.removeAttribute('aria-describedby');
        }
        glossaryUiState.activeButton = null;
        glossaryUiState.pinned = false;
    }

    function openGlossarySheet(button, entry) {
        closeGlossaryPopover(true);
        const sheet = document.getElementById('glossary-sheet');
        if (!sheet) return;
        glossaryUiState.activeButton = button;
        glossaryUiState.returnFocus = button;
        button.setAttribute('aria-expanded', 'true');
        setGlossaryContent('glossary-sheet', entry);
        sheet.hidden = false;
        document.body.classList.add('glossary-open');
        document.getElementById('glossary-sheet-close')?.focus({ preventScroll: true });
    }

    function closeGlossarySheet(restoreFocus) {
        const sheet = document.getElementById('glossary-sheet');
        if (!sheet || sheet.hidden) return;
        sheet.hidden = true;
        document.body.classList.remove('glossary-open');
        if (glossaryUiState.activeButton) {
            glossaryUiState.activeButton.setAttribute('aria-expanded', 'false');
        }
        const returnFocus = glossaryUiState.returnFocus;
        glossaryUiState.activeButton = null;
        glossaryUiState.returnFocus = null;
        if (restoreFocus && returnFocus?.isConnected) {
            returnFocus.focus({ preventScroll: true });
        }
    }

    function closeGlossaryUi(restoreFocus) {
        closeGlossaryPopover(true);
        closeGlossarySheet(restoreFocus);
    }

    function setGlossaryContent(prefix, entry) {
        const type = glossaryTypeLabel(entry.type);
        setText(`${prefix}-term`, entry.term || 'Term');
        setText(`${prefix}-type`, type);
        setText(`${prefix}-zh`, entry.term_zh || '');
        setText(`${prefix}-description`, entry.description_zh || '');
    }

    function glossaryTypeLabel(type) {
        return ({
            person: '人物',
            organization: '机构',
            financial_term: '金融术语',
            policy_law: '政策与法律',
            technology: '技术',
            event: '事件',
            concept: '专业概念',
            work: '作品',
        })[type] || '专业概念';
    }

    function setupGlossaryUi() {
        document.getElementById('glossary-sheet-backdrop')
            ?.addEventListener('click', () => closeGlossarySheet(true));
        document.getElementById('glossary-sheet-close')
            ?.addEventListener('click', () => closeGlossarySheet(true));
        const popover = document.getElementById('glossary-popover');
        popover?.addEventListener('mouseenter', cancelGlossaryHide);
        popover?.addEventListener('mouseleave', scheduleGlossaryHide);
        document.addEventListener('pointerdown', event => {
            if (!glossaryUiState.pinned) return;
            if (event.target.closest?.('.glossary-term, .glossary-popover')) return;
            closeGlossaryPopover(true);
        });
        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            closeGlossaryUi(true);
        });
        window.addEventListener('resize', () => closeGlossaryPopover(true));
        window.addEventListener('scroll', () => closeGlossaryPopover(true), { passive: true });
    }

    function bindImageZoom() {
        const issue = state.currentIssue;
        const view = document.getElementById('view-issue');
        view.querySelectorAll('img').forEach(img => {
            if (img.dataset.zoomBound === '1') return;
            img.dataset.zoomBound = '1';
            img.style.cursor = 'zoom-in';
            img.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                const src = img.currentSrc || img.src;
                const caption = img.closest('figure')?.querySelector('figcaption')?.textContent?.trim()
                    || img.alt || '';
                openLightbox([{ path: resolveIssueAsset(issue, src), caption }], 0);
            });
        });
    }

    function highlightCurrentArticle() {
        document.querySelectorAll('.article-item').forEach(item => {
            const active = state.currentIssueView === 'article'
                && item.dataset.articleId === state.currentArticleId
                && item.dataset.primaryMembership === 'true';
            item.classList.toggle('is-active', active);
            if (active) item.setAttribute('aria-current', 'true');
            else item.removeAttribute('aria-current');
        });
        setTimeout(() => {
            const active = document.querySelector('#article-list .article-item.is-active');
            if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, 50);
    }

    function updateArticleNavigation() {
        const articles = state.currentArticles || [];
        const index = articles.findIndex(article => article.id === state.currentArticleId);
        const prevArticle = index > 0 ? articles[index - 1] : null;
        const nextArticle = index >= 0 && index < articles.length - 1 ? articles[index + 1] : null;
        updateArticleNavButton('article-nav-prev', 'article-nav-prev-title', prevArticle, '已是本期第一篇');
        updateArticleNavButton('article-nav-next', 'article-nav-next-title', nextArticle, '已是本期最后一篇');
    }

    function updateArticleNavButton(buttonId, titleId, article, emptyText) {
        const button = document.getElementById(buttonId);
        const title = document.getElementById(titleId);
        if (!button || !title) return;
        button.disabled = !article;
        button.classList.toggle('is-disabled', !article);
        button.classList.toggle('is-visible', !!parseHash().issueId);
        title.textContent = article ? (article.title_zh || article.title || emptyText) : emptyText;
        button.onclick = () => {
            if (!article || !state.currentIssueId) return;
            stopTts();
            navigate(`/issue/${encodeURIComponent(state.currentIssueId)}/${encodeURIComponent(article.id)}`);
        };
    }

    function openLightbox(images, idx) {
        lightboxState.images = images;
        lightboxState.idx = idx;
        renderLightbox();
        document.getElementById('lightbox').hidden = false;
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        document.getElementById('lightbox').hidden = true;
        document.body.style.overflow = '';
    }

    function renderLightbox() {
        const image = lightboxState.images[lightboxState.idx];
        if (!image) return;
        const src = typeof image === 'string' ? image : image.path;
        const caption = typeof image === 'string' ? '' : (image.caption || '');
        const total = lightboxState.images.length;
        setImage('lightbox-image', src, caption || '图片');
        setText('lightbox-caption', caption);
        setText('lightbox-counter', total > 1 ? `${lightboxState.idx + 1} / ${total}` : '');
        document.getElementById('lightbox-prev').style.display = total > 1 ? '' : 'none';
        document.getElementById('lightbox-next').style.display = total > 1 ? '' : 'none';
    }

    function lightboxPrev() {
        if (!lightboxState.images.length) return;
        lightboxState.idx = (lightboxState.idx - 1 + lightboxState.images.length) % lightboxState.images.length;
        renderLightbox();
    }

    function lightboxNext() {
        if (!lightboxState.images.length) return;
        lightboxState.idx = (lightboxState.idx + 1) % lightboxState.images.length;
        renderLightbox();
    }

    function setupLightbox() {
        document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
        document.getElementById('lightbox-prev').addEventListener('click', lightboxPrev);
        document.getElementById('lightbox-next').addEventListener('click', lightboxNext);
        document.getElementById('lightbox').addEventListener('click', event => {
            if (event.target.id === 'lightbox') closeLightbox();
        });
        document.addEventListener('keydown', event => {
            const lightbox = document.getElementById('lightbox');
            if (lightbox.hidden) return;
            if (event.key === 'Escape') closeLightbox();
            if (event.key === 'ArrowLeft') lightboxPrev();
            if (event.key === 'ArrowRight') lightboxNext();
        });
    }

    function focusableElements(root) {
        return Array.from(root.querySelectorAll(
            'button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), '
            + 'a[href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(element => !element.closest('[hidden]') && element.getClientRects().length > 0);
    }

    function openTocSheet(trigger) {
        const sheet = document.getElementById('toc-sheet');
        const body = document.getElementById('toc-sheet-body');
        const search = document.getElementById('toc-search');
        if (!state.currentIssue) return;
        if (tocUiState.hideTimer !== null) {
            clearTimeout(tocUiState.hideTimer);
            tocUiState.hideTimer = null;
        }
        tocUiState.returnFocus = trigger instanceof HTMLElement ? trigger : document.activeElement;
        body.innerHTML = renderArticleList(state.currentIssue);
        bindIssueLinks(body, state.currentIssue, true);
        syncIssueSearchInputs();
        applyTocSearch();
        sheet.hidden = false;
        void sheet.offsetWidth;
        sheet.classList.add('is-open');
        document.querySelectorAll('[data-toc-trigger]').forEach(trigger => {
            trigger.classList.add('is-active');
            trigger.setAttribute('aria-expanded', 'true');
        });
        document.body.style.overflow = 'hidden';
        window.requestAnimationFrame(() => {
            const target = search || body.querySelector('[aria-current], button');
            target?.focus();
        });
    }

    function closeTocSheet(restoreFocus = true, immediate = false) {
        const sheet = document.getElementById('toc-sheet');
        if (!sheet) return;
        sheet.classList.remove('is-open');
        if (tocUiState.hideTimer !== null) clearTimeout(tocUiState.hideTimer);
        if (immediate) {
            sheet.hidden = true;
            tocUiState.hideTimer = null;
        } else {
            tocUiState.hideTimer = setTimeout(() => {
                tocUiState.hideTimer = null;
                if (!sheet.classList.contains('is-open')) sheet.hidden = true;
            }, 300);
        }
        document.querySelectorAll('[data-toc-trigger]').forEach(trigger => {
            trigger.classList.remove('is-active');
            trigger.setAttribute('aria-expanded', 'false');
        });
        document.body.style.overflow = '';
        const returnFocus = tocUiState.returnFocus;
        tocUiState.returnFocus = null;
        if (restoreFocus && returnFocus instanceof HTMLElement && returnFocus.isConnected) {
            returnFocus.focus();
        }
    }

    function setupTocSheet() {
        document.querySelectorAll('[data-toc-trigger]').forEach(trigger => {
            trigger.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                const sheet = document.getElementById('toc-sheet');
                sheet.classList.contains('is-open') ? closeTocSheet() : openTocSheet(event.currentTarget);
            });
        });
        document.getElementById('toc-sheet-backdrop').addEventListener('click', closeTocSheet);
        document.getElementById('toc-sheet-close').addEventListener('click', closeTocSheet);
        const input = document.getElementById('toc-search');
        const clear = document.getElementById('toc-search-clear');
        input.addEventListener('input', () => updateIssueSearch(input.value));
        clear.addEventListener('click', () => {
            updateIssueSearch('');
            input.focus();
        });
        document.getElementById('toc-sheet').addEventListener('keydown', event => {
            const sheet = event.currentTarget;
            if (!sheet.classList.contains('is-open')) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                closeTocSheet();
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = focusableElements(sheet.querySelector('.toc-sheet-panel'));
            if (!focusable.length) {
                event.preventDefault();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });
    }

    function setupThemeToggle() {
        const stored = safeLocalStorageGet(THEME_KEY);
        const theme = stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        applyTheme(theme);
        document.getElementById('theme-toggle').addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') || 'light';
            applyTheme(current === 'light' ? 'dark' : 'light');
        });
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem(THEME_KEY, theme); } catch (error) { /* ignore */ }
    }

    function safeLocalStorageGet(key) {
        try { return localStorage.getItem(key); } catch (error) { return null; }
    }

    function setupWallSearch() {
        const input = document.getElementById('wall-search');
        const clear = document.getElementById('wall-search-clear');
        if (!input || !clear) return;
        input.addEventListener('input', applyWallSearch);
        clear.addEventListener('click', () => {
            input.value = '';
            applyWallSearch();
            input.focus();
        });
        input.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                input.value = '';
                applyWallSearch();
            }
        });
    }

    function applyWallSearch() {
        const input = document.getElementById('wall-search');
        const clear = document.getElementById('wall-search-clear');
        const grid = document.getElementById('cover-grid');
        if (!input || !clear || !grid) return;
        const query = input.value.trim().toLowerCase();
        clear.hidden = !query;
        let visible = 0;
        grid.querySelectorAll('.cover-card').forEach(card => {
            const matched = !query || (card.dataset.search || '').includes(query);
            card.classList.toggle('is-hidden', !matched);
            if (matched) visible++;
        });
        grid.classList.toggle('is-empty', visible === 0);
    }

    function setupNavSearch() {
        const input = document.getElementById('nav-search');
        const clear = document.getElementById('nav-search-clear');
        input.addEventListener('input', () => updateIssueSearch(input.value));
        clear.addEventListener('click', () => {
            updateIssueSearch('');
            input.focus();
        });
        input.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                updateIssueSearch('');
            }
        });
    }

    function activateIssueSearch(issueId) {
        if (state.issueSearchIssueId !== issueId) {
            state.issueSearchIssueId = issueId;
            state.issueSearchQuery = '';
        }
        syncIssueSearchInputs();
    }

    function clearIssueSearch() {
        state.issueSearchIssueId = null;
        state.issueSearchQuery = '';
        syncIssueSearchInputs();
    }

    function syncIssueSearchInputs() {
        ['nav-search', 'toc-search'].forEach(id => {
            const input = document.getElementById(id);
            if (input && input.value !== state.issueSearchQuery) input.value = state.issueSearchQuery;
        });
    }

    function updateIssueSearch(query) {
        state.issueSearchQuery = String(query || '');
        syncIssueSearchInputs();
        applyNavSearch();
        applyTocSearch();
    }

    function applyNavSearch() {
        const input = document.getElementById('nav-search');
        const clear = document.getElementById('nav-search-clear');
        const list = document.getElementById('article-list');
        const empty = document.getElementById('nav-search-empty');
        if (!input || !clear || !list || !empty) return;
        const query = state.issueSearchQuery.trim().toLowerCase();
        clear.hidden = !query;
        let totalVisible = 0;
        list.querySelectorAll('.article-group').forEach(group => {
            let groupVisible = 0;
            const pageLink = group.querySelector('[data-page-link], [data-frontpage]');
            const pageMatched = !!pageLink && (!query || (pageLink.dataset.searchTitle || '').includes(query));
            group.querySelectorAll('.article-item').forEach(item => {
                const matched = !query || (item.dataset.searchTitle || '').includes(query);
                item.classList.toggle('is-hidden', !matched);
                if (matched) {
                    groupVisible++;
                    totalVisible++;
                }
            });
            group.classList.toggle('is-hidden', groupVisible === 0 && !pageMatched);
            if (pageMatched && groupVisible === 0) totalVisible++;
        });
        empty.hidden = totalVisible > 0 || !query;
    }

    function applyTocSearch() {
        const input = document.getElementById('toc-search');
        const clear = document.getElementById('toc-search-clear');
        const list = document.getElementById('toc-sheet-body');
        const empty = document.getElementById('toc-search-empty');
        if (!input || !clear || !list || !empty) return;
        const query = state.issueSearchQuery.trim().toLowerCase();
        clear.hidden = !query;
        let totalVisible = 0;
        list.querySelectorAll('.article-group').forEach(group => {
            let groupVisible = 0;
            const pageLink = group.querySelector('[data-page-link], [data-frontpage]');
            const pageMatched = !!pageLink && (!query || (pageLink.dataset.searchTitle || '').includes(query));
            group.querySelectorAll('.article-item').forEach(item => {
                const matched = !query || (item.dataset.searchTitle || '').includes(query);
                item.classList.toggle('is-hidden', !matched);
                if (matched) {
                    groupVisible++;
                    totalVisible++;
                }
            });
            group.classList.toggle('is-hidden', groupVisible === 0 && !pageMatched);
            if (pageMatched && groupVisible === 0) totalVisible++;
        });
        empty.hidden = totalVisible > 0 || !query;
    }

    function setupBackToTop() {
        const button = document.getElementById('back-to-top');
        const update = () => {
            const visible = document.body.classList.contains('in-issue') && window.scrollY > 520;
            button.classList.toggle('is-visible', visible);
        };
        window.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
        button.addEventListener('click', () => {
            button.classList.remove('is-visible');
            scrollDocumentToTop();
        });
    }

    let currentUtterance = null;

    function setupTtsButtons() {
        bindTts('tts-summary', () => document.getElementById('summary-content').textContent, 'zh-CN');
        bindTts('tts-bilingual-zh', () => collectBilingualText('zh'), 'zh-CN');
        bindTts('tts-bilingual-en', () => collectBilingualText('en'), 'en-US');
    }

    function bindTts(buttonId, getText, lang) {
        const button = document.getElementById(buttonId);
        if (!button) return;
        button.addEventListener('click', () => {
            if (!('speechSynthesis' in window)) return;
            if (button.classList.contains('is-playing')) {
                stopTts();
                return;
            }
            stopTts();
            const text = String(getText() || '').trim();
            if (!text) return;
            currentUtterance = new SpeechSynthesisUtterance(text.slice(0, 18000));
            currentUtterance.lang = lang;
            currentUtterance.rate = lang.startsWith('zh') ? 0.95 : 1.0;
            currentUtterance.onend = stopTts;
            currentUtterance.onerror = stopTts;
            button.classList.add('is-playing');
            const label = button.querySelector('.tts-label');
            if (label) label.textContent = '停止';
            window.speechSynthesis.speak(currentUtterance);
        });
    }

    function stopTts() {
        if ('speechSynthesis' in window) {
            try { window.speechSynthesis.cancel(); } catch (error) { /* ignore */ }
        }
        currentUtterance = null;
        document.querySelectorAll('.tts-btn.is-playing').forEach(button => {
            button.classList.remove('is-playing');
            const label = button.querySelector('.tts-label');
            if (label) label.textContent = label.textContent.includes('中文') ? '朗读中文'
                : label.textContent.includes('英文') ? '朗读英文'
                : '朗读';
        });
    }

    function collectBilingualText(lang) {
        const selector = lang === 'en' ? '.bilingual-pair-en' : '.bilingual-pair-zh';
        return Array.from(document.querySelectorAll(selector))
            .map(node => node.textContent.trim())
            .filter(Boolean)
            .join('\n\n');
    }

    function route() {
        closeTocSheet(false, true);
        const routeState = parseHash();
        const { publication, issueId } = routeState;
        if (issueId) {
            switchView('view-issue', () => renderIssue(issueId, routeState));
        } else if (publication) {
            clearIssueSearch();
            state.currentPublication = publication;
            switchView('view-wall', renderWall);
        } else {
            clearIssueSearch();
            state.currentPublication = null;
            state.currentIssueId = null;
            state.currentArticleId = null;
            state.currentIssueView = null;
            state.currentPageLabel = null;
            state.currentIssue = null;
            state.currentArticles = [];
            switchView('view-wall', renderWall);
        }
        document.body.classList.toggle('in-issue', !!issueId);
        document.body.classList.remove('in-publication');
        updateArticleNavigation();
    }

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value == null ? '' : String(value);
    }

    function setHtml(id, value) {
        const el = document.getElementById(id);
        if (el) el.innerHTML = value == null ? '' : String(value);
    }

    function setImage(id, src, alt) {
        const el = document.getElementById(id);
        if (!el) return;
        el.src = src || '';
        el.alt = alt || '';
    }

    function init() {
        setText('masthead-date', todayChinese());
        setText('footer-year', new Date().getFullYear());
        document.getElementById('btn-back').addEventListener('click', () => {
            const issue = state.currentIssue || INDEX.find(item => item.id === state.currentIssueId);
            navigate(issue?.publication_type ? `/publication/${encodeURIComponent(issue.publication_type)}` : '/');
        });
        document.getElementById('btn-publication-back')?.addEventListener('click', () => navigate('/'));
        setupThemeToggle();
        setupLightbox();
        setupTocSheet();
        setupWallSearch();
        setupNavSearch();
        setupBackToTop();
        setupTtsButtons();
        setupGlossaryUi();
        renderWall();
        route();
        window.addEventListener('hashchange', route);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
