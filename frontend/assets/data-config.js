/**
 * Static data-source configuration.
 *
 * Browsers load data over HTTP(S), so a filesystem directory must be exposed
 * by the web server first. Production exposes the Economist archive under a
 * same-origin URL, keeping the browser independent from server filesystem paths.
 */
(function () {
    'use strict';

    const existing = window.PAPER_ARCHIVE_CONFIG || {};
    window.PAPER_ARCHIVE_CONFIG = {
        primaryDatabaseRoot: '../output_results/',
        primaryIndexUrl: '',
        teDatabaseRoot: '/economist-output/',
        teIndexUrl: '',
        teFallbackToPrimary: false,
        ...existing,
    };
})();
