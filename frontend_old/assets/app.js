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
        CX: '财新周刊',
        WSJ: 'The Wall Street Journal',
        FT: 'Financial Times',
        TE: 'The Economist',
    };
    const PUBLICATION_ORDER = ['CX', 'WSJ', 'FT', 'TE'];

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
        currentIssue: null,
        currentArticles: [],
    };

    const lightboxState = { images: [], idx: 0 };
    const glossaryUiState = {
        activeButton: null,
        pinned: false,
        hideTimer: null,
        returnFocus: null,
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

    function issueBasePath(issue) {
        const dbPath = issue && issue.database_path ? issue.database_path : '';
        const dir = dirname(dbPath);
        return DATABASE_ROOT + (dir ? dir + '/' : '');
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
            return { publication: decodeURIComponent(parts[1]), issueId: null, articleId: null };
        }
        if (parts[0] === 'issue' && parts[1]) {
            return { publication: null, issueId: decodeURIComponent(parts[1]), articleId: decodeURIComponent(parts[2] || '') || null };
        }
        return { publication: null, issueId: null, articleId: null };
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
        const current = document.querySelector('.view.is-active');
        const next = document.getElementById(viewId);
        if (!next) return;
        if (current && current !== next) {
            current.classList.add('is-leaving');
            setTimeout(() => {
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
            issue.issue_title,
            issue.issue_number,
            issue.year_issue,
            issue.source_line,
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
        const issueTitle = issue.issue_title || (issue.issue_number ? `《财新周刊》总第${issue.issue_number}期` : publicationLabel);
        const issuePeriod = issue.year_issue || issue.original_filename || issue.id || '';
        const cover = resolveIssueAsset(issue, issue.cover_image || '');
        return `
            <article class="cover-card" data-issue-id="${escapeHtml(issue.id)}"
                     data-search="${escapeHtml(issueSearchText(issue))}">
                <div class="cover-image-wrap">
                    ${cover ? `<img class="cover-image" src="${escapeHtml(cover)}" alt="${escapeHtml(publicationLabel)} ${escapeHtml(dateLabel)}" loading="lazy">` : ''}
                    <div class="cover-image-fallback" ${cover ? 'hidden' : ''}>${escapeHtml(initials)}</div>
                </div>
                <div class="cover-body">
                    <div class="cover-date">出版日期 · ${escapeHtml(dateLabel)}</div>
                    <div class="cover-id">${escapeHtml(issueTitle)}</div>
                    <div class="cover-file">${escapeHtml(issuePeriod)}</div>
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
                    state.currentPublication = tab.dataset.publication || null;
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
            script.src = DATABASE_ROOT + indexItem.database_path
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
        const section = article.category || article.section || 'General';
        return {
            ...article,
            id,
            section,
            title: article.title || 'Untitled',
            title_zh: article.title_zh || '',
            images: Array.isArray(article.images) ? article.images : [],
            image_placements: Array.isArray(article.image_placements) ? article.image_placements : [],
            image_insights: Array.isArray(article.image_insights) ? article.image_insights : [],
            term_annotations: Array.isArray(article.term_annotations) ? article.term_annotations : [],
            paragraphs: normalizeParagraphs(article, id),
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

    function renderArticleList(articles) {
        const groups = new Map();
        articles.forEach(article => {
            const section = article.section || 'General';
            if (!groups.has(section)) groups.set(section, []);
            groups.get(section).push(article);
        });

        return Array.from(groups.entries()).map(([section, items]) => `
            <div class="article-group">
                <div class="article-group-header">${escapeHtml(section)}</div>
                ${items.map(article => {
                    const isChineseOnly = article.publication_type === 'CX'
                        || (article.title_zh && article.title_zh === article.title);
                    const searchText = [
                        article.title_zh,
                        article.title,
                        article.section,
                        article.summary_md,
                        article.content_markdown,
                    ].join(' ');
                    return `
                        <button class="article-item" data-article-id="${escapeHtml(article.id)}"
                                data-search-title="${escapeHtml(searchText.toLowerCase())}">
                            <div class="article-item-title-zh">${escapeHtml(article.title_zh || article.title)}</div>
                            ${isChineseOnly ? '' : `<div class="article-item-title-en">${escapeHtml(article.title)}</div>`}
                            <span class="article-match-badge" data-match-info></span>
                        </button>
                    `;
                }).join('')}
            </div>
        `).join('');
    }

    function renderIssue(issueId, articleId) {
        const indexItem = INDEX.find(item => item.id === issueId);
        if (!indexItem) {
            navigate('/');
            return;
        }

        setText('issue-id-label', publicationName(indexItem.publication_type || indexItem.id));
        setText('issue-date-label', formatDate(indexItem.publication_date));
        setText('article-count', '加载中');
        setText('current-section', 'Loading');
        setText('current-title-zh', '正在加载数据库...');
        setText('current-title-en', indexItem.original_filename || '');
        setHtml('summary-content', '<p>正在读取本期 database.js。</p>');
        setHtml('bilingual-grid', '');

        loadIssueDatabase(issueId)
            .then(db => {
                const issue = { ...indexItem, ...db };
                issue.database_path = indexItem.database_path || issue.database_path;
                issue.glossary = issue.glossary && typeof issue.glossary === 'object'
                    ? issue.glossary
                    : {};
                issue.articles = (issue.articles || []).map(article => normalizeArticle(article, issue));
                state.currentIssueId = issueId;
                state.currentIssue = issue;
                state.currentArticles = issue.articles;
                renderLoadedIssue(issue, articleId);
            })
            .catch(error => {
                console.error(error);
                setText('current-section', 'Error');
                setText('current-title-zh', '数据库加载失败');
                setText('current-title-en', error.message);
                setHtml('summary-content', `<p>${escapeHtml(error.message)}</p>`);
            });
    }

    function renderLoadedIssue(issue, articleId) {
        const articleCount = issue.articles.length;
        setText('issue-id-label', publicationName(issue.publication_type || issue.id));
        const issueLabel = [issue.issue_title, issue.year_issue, formatDate(issue.publication_date)].filter(Boolean).join(' · ');
        setText('issue-date-label', issueLabel || issue.original_filename || '');
        setText('article-count', `${articleCount} 篇`);
        setText('article-bottom-toc-count', `本期共 ${articleCount} 篇文章`);

        const list = document.getElementById('article-list');
        list.innerHTML = renderArticleList(issue.articles);
        list.querySelectorAll('.article-item').forEach(item => {
            item.addEventListener('click', () => {
                if (item.dataset.articleId) {
                    navigate(`/issue/${encodeURIComponent(issue.id)}/${encodeURIComponent(item.dataset.articleId)}`);
                }
            });
        });

        let target = articleId ? issue.articles.find(article => article.id === articleId) : null;
        if (!target && issue.articles.length) target = issue.articles[0];

        if (target) {
            state.currentArticleId = target.id;
            renderArticle(target, issue);
            if (!articleId) {
                navigate(`/issue/${encodeURIComponent(issue.id)}/${encodeURIComponent(target.id)}`, true);
            }
        } else {
            renderNoArticle(issue);
        }

        highlightCurrentArticle();
        applyNavSearch();
        scrollDocumentToTop();
    }

    function renderNoArticle(issue) {
        setText('current-section', publicationName(issue.publication_type || 'General'));
        setText('current-title-zh', '本期暂无文章');
        setText('current-title-en', issue.original_filename || '');
        setHtml('summary-content', '<p>当前 database.js 中没有可展示文章。</p>');
        setHtml('bilingual-grid', '<p class="bilingual-empty">暂无正文。</p>');
    }

    function renderArticle(article, issue) {
        closeGlossaryUi(false);
        setText('current-section', article.section || 'General');
        setText('current-title-zh', article.title_zh || article.title || '');
        setText('current-title-en', issue.publication_type === 'CX' ? '' : (article.title || ''));

        const summary = article.summary_md || buildLocalSummary(article);
        setHtml('summary-content', renderMarkdown(summary, issue));
        renderBilingual(article, issue);
        bindImageZoom(article, issue);
        updateArticleNavigation();
    }

    function buildLocalSummary(article) {
        const words = String(article.content_markdown || '').split(/\s+/).filter(Boolean).length;
        const lines = [
            '### 基本信息',
            `- 分类：${article.section || 'General'}`,
            `- 正文字数：约 ${words} words`,
            '',
            '### 处理状态',
            article.compiled_article ? '- 已完成 LLM 结构化编译。' : '- 当前文章使用本地段落整理，暂无中文深度解读。',
        ];
        if (Number(article.page) > 0) lines.splice(2, 0, `- 页码：${article.page}`);
        return lines.join('\n');
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

        const placements = normalizeImagePlacements(article);
        const hasPlacements = placements.length > 0;
        const leadMarkup = hasPlacements
            ? renderPlacedImages(placements.filter(item => item.placement === 'lead'), issue, 'lead')
            : renderArticleImages(article, issue);
        const isCaixin = issue && issue.publication_type === 'CX';
        grid.classList.toggle('is-source-only', Boolean(isCaixin));
        const paragraphMarkup = paragraphs.map((paragraph, index) => {
            const zh = paragraph.zh_text
                ? renderMarkdown(paragraph.zh_text, issue)
                : '';
            const en = paragraph.en_text
                ? renderMarkdown(paragraph.en_text, issue)
                : '';
            const placedAfter = hasPlacements
                ? renderPlacedImages(
                    placements.filter(item => item.placement === 'after_paragraph'
                        && Number(item.after_paragraph_index) === index + 1),
                    issue,
                    'inline'
                )
                : '';
            if (isCaixin) {
                return `
                <div class="bilingual-pair source-only" data-para-id="${escapeHtml(paragraph.para_id || '')}"
                     data-paragraph-index="${index + 1}">
                    <div class="bilingual-pair-zh">${zh}</div>
                </div>
                ${placedAfter}`;
            }
            return `
                <div class="bilingual-pair" data-para-id="${escapeHtml(paragraph.para_id || '')}"
                     data-paragraph-index="${index + 1}">
                    <div class="bilingual-pair-en">${en}</div>
                    <div class="bilingual-pair-zh">${zh}</div>
                </div>
                ${placedAfter}`;
        }).join('');
        const unlocatedMarkup = hasPlacements
            ? renderPlacedImages(
                placements.filter(item => !['lead', 'after_paragraph'].includes(item.placement)),
                issue,
                'unlocated'
            )
            : '';
        grid.innerHTML = leadMarkup + paragraphMarkup + unlocatedMarkup;
        applyGlossaryAnnotations(grid, article, issue);
    }

    function normalizeImagePlacements(article) {
        const knownPaths = new Set((article.images || []).map(String));
        return (article.image_placements || [])
            .filter(item => item && item.path && (!knownPaths.size || knownPaths.has(String(item.path))))
            .map(item => ({
                path: String(item.path),
                placement: item.placement || 'unlocated',
                after_paragraph_index: item.after_paragraph_index,
                caption: item.caption || '',
                credit: item.credit || '',
                alt_text: item.alt_text || '',
            }));
    }

    function renderPlacedImages(items, issue, position) {
        if (!items.length) return '';
        const title = position === 'unlocated' ? '<div class="article-image-analysis-title">未定位图片</div>' : '';
        return `<div class="article-image-analysis article-image-${escapeHtml(position)}">${title}<div class="article-image-grid">${items.map((item, index) => {
            const src = resolveIssueAsset(issue, item.path);
            const alt = item.alt_text || item.caption || '';
            const captionParts = [item.caption, item.credit].filter(Boolean);
            return `<figure class="article-image-item" data-image-index="${index}">
                <img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy">
                ${captionParts.length ? `<figcaption>${captionParts.map(escapeHtml).join('<br>')}</figcaption>` : ''}
            </figure>`;
        }).join('')}</div></div>`;
    }

    function renderArticleImages(article, issue) {
        const images = (article.images || []).map(path => ({
            path: resolveIssueAsset(issue, path),
            rawPath: path,
        }));
        if (!images.length) return '';
        return `<div class="article-image-analysis"><div class="article-image-analysis-title">图片与图表</div><div class="article-image-grid">${images.map((image, index) => {
            const caption = article.title || '';
            return `<figure class="article-image-item" data-image-index="${index}"><img src="${escapeHtml(image.path)}" alt="${escapeHtml(caption)}" loading="lazy"><figcaption>${escapeHtml(caption)}</figcaption></figure>`;
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
            item.classList.toggle('is-active', item.dataset.articleId === state.currentArticleId);
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

    function openTocSheet() {
        const sheet = document.getElementById('toc-sheet');
        const body = document.getElementById('toc-sheet-body');
        body.innerHTML = renderArticleList(state.currentArticles || []);
        body.querySelectorAll('.article-item').forEach(item => {
            item.classList.toggle('is-active', item.dataset.articleId === state.currentArticleId);
            item.addEventListener('click', () => {
                closeTocSheet();
                if (item.dataset.articleId && item.dataset.articleId !== state.currentArticleId) {
                    navigate(`/issue/${encodeURIComponent(state.currentIssueId)}/${encodeURIComponent(item.dataset.articleId)}`);
                }
            });
        });
        sheet.hidden = false;
        void sheet.offsetWidth;
        sheet.classList.add('is-open');
        document.querySelectorAll('[data-toc-trigger]').forEach(trigger => {
            trigger.classList.add('is-active');
            trigger.setAttribute('aria-expanded', 'true');
        });
        document.body.style.overflow = 'hidden';
    }

    function closeTocSheet() {
        const sheet = document.getElementById('toc-sheet');
        sheet.classList.remove('is-open');
        setTimeout(() => {
            if (!sheet.classList.contains('is-open')) sheet.hidden = true;
        }, 300);
        document.querySelectorAll('[data-toc-trigger]').forEach(trigger => {
            trigger.classList.remove('is-active');
            trigger.setAttribute('aria-expanded', 'false');
        });
        document.body.style.overflow = '';
    }

    function setupTocSheet() {
        document.querySelectorAll('[data-toc-trigger]').forEach(trigger => {
            trigger.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                const sheet = document.getElementById('toc-sheet');
                sheet.classList.contains('is-open') ? closeTocSheet() : openTocSheet();
            });
        });
        document.getElementById('toc-sheet-backdrop').addEventListener('click', closeTocSheet);
        document.getElementById('toc-sheet-close').addEventListener('click', closeTocSheet);
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
        input.addEventListener('input', applyNavSearch);
        clear.addEventListener('click', () => {
            input.value = '';
            applyNavSearch();
            input.focus();
        });
        input.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                input.value = '';
                applyNavSearch();
            }
        });
    }

    function applyNavSearch() {
        const input = document.getElementById('nav-search');
        const clear = document.getElementById('nav-search-clear');
        const list = document.getElementById('article-list');
        const empty = document.getElementById('nav-search-empty');
        if (!input || !clear || !list || !empty) return;
        const query = input.value.trim().toLowerCase();
        clear.hidden = !query;
        let totalVisible = 0;
        list.querySelectorAll('.article-group').forEach(group => {
            let groupVisible = 0;
            group.querySelectorAll('.article-item').forEach(item => {
                const matched = !query || (item.dataset.searchTitle || '').includes(query);
                item.classList.toggle('is-hidden', !matched);
                if (matched) {
                    groupVisible++;
                    totalVisible++;
                }
            });
            group.classList.toggle('is-hidden', groupVisible === 0);
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

    function selectVoice(lang) {
        const voices = window.speechSynthesis.getVoices();
        if (!voices.length) return null;
        const isEnglish = lang.toLowerCase().startsWith('en');
        const preferredNames = isEnglish
            ? ['daniel', 'oliver', 'samantha', 'karen', 'google uk english', 'google us english']
            : [];
        const scored = voices.map(voice => {
            const voiceLang = String(voice.lang || '').toLowerCase();
            const voiceName = String(voice.name || '').toLowerCase();
            let score = 0;
            if (isEnglish) {
                if (!voiceLang.startsWith('en')) return { voice, score: -1000 };
                score += voiceLang.startsWith('en-gb') ? 120 : 80;
                if (preferredNames.some(name => voiceName.includes(name))) score += 30;
                if (voice.localService) score += 5;
            } else if (voiceLang.startsWith('zh')) {
                score += voiceLang.startsWith('zh-cn') ? 120 : 80;
            } else {
                score = -1000;
            }
            return { voice, score };
        }).sort((left, right) => right.score - left.score);
        return scored[0] && scored[0].score > -1000 ? scored[0].voice : null;
    }

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
            const voice = selectVoice(lang);
            if (voice) currentUtterance.voice = voice;
            currentUtterance.rate = lang.startsWith('zh') ? 0.95 : 0.92;
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

    if ('speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
        window.speechSynthesis.getVoices();
    }

    function collectBilingualText(lang) {
        const selector = lang === 'en' ? '.bilingual-pair-en' : '.bilingual-pair-zh';
        return Array.from(document.querySelectorAll(selector))
            .map(node => node.textContent.trim())
            .filter(Boolean)
            .join('\n\n');
    }

    function route() {
        const { publication, issueId, articleId } = parseHash();
        if (issueId) {
            switchView('view-issue', () => renderIssue(issueId, articleId));
        } else if (publication) {
            state.currentPublication = publication;
            switchView('view-wall', renderWall);
        } else {
            state.currentPublication = null;
            state.currentIssueId = null;
            state.currentArticleId = null;
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
