const { ipcRenderer } = require('electron');

class ConsoleManager {
    constructor() {
        this.autoScroll = true;
        this.loggerContent = null;
        this.scrollToBottomBtn = null;
        this.hwid = '';
        this.initialized = false;
        this.logs = [];
        this.logQueue = [];
        this.processingQueue = false;
        this.lastLogTime = 0;
        this.rapidLogThreshold = 100;
        this.rapidLogCount = 0;
        this.skipAnimations = false;
        this.batchSize = 50;
        this.maxQueueSize = 1000;

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    async init() {
        if (this.initialized) return;
        this.loggerContent = document.getElementById('logger-content');
        this.scrollToBottomBtn = document.getElementById('scroll-to-bottom-btn');
        this.setupEventListeners();
        this.setupIpcListeners();
        await this.initSystemInfo();
        this.updateAutoScrollIcon();
        try { ipcRenderer.send('request-dynamic-colors'); } catch {}
        try {
            ipcRenderer.send('request-server-config');
            setTimeout(() => {
                const patchToolkitBtn = document.getElementById('patch-toolkit-btn');
                if (patchToolkitBtn && patchToolkitBtn.style.display !== 'inline-block') {
                    patchToolkitBtn.style.display = 'none';
                    this.addLog('warn', '[Console] Timeout esperando configuración del servidor, manteniendo Toolkit de parches oculto', null, 'Console');
                }
            }, 3000);
        } catch {
            const patchToolkitBtn = document.getElementById('patch-toolkit-btn');
            if (patchToolkitBtn) patchToolkitBtn.style.display = 'none';
        }
        this.initialized = true;
        this.addLog('info', 'Consola inicializada correctamente', null, 'Console');
    }

    setupEventListeners() {
        const clearBtn = document.getElementById('clear-logs-btn');
        if (clearBtn) clearBtn.addEventListener('click', () => this.clearLogs());
        const exportBtn = document.getElementById('export-logs-btn');
        if (exportBtn) exportBtn.addEventListener('click', () => this.exportLogs());
        const autoScrollBtn = document.getElementById('toggle-autoscroll-btn');
        if (autoScrollBtn) autoScrollBtn.addEventListener('click', () => this.toggleAutoScroll());
        if (this.scrollToBottomBtn) this.scrollToBottomBtn.addEventListener('click', () => this.scrollToBottom());
        const copyHwidBtn = document.getElementById('copy-hwid-btn');
        if (copyHwidBtn) copyHwidBtn.addEventListener('click', () => this.copyHwid());
        const reportBtn = document.getElementById('report-issue-btn');
        if (reportBtn) reportBtn.addEventListener('click', () => {
            this.reportIssue();
            ipcRenderer.send('console-window-close');
        });
        const patchBtn = document.getElementById('patch-toolkit-btn');
        if (patchBtn) patchBtn.addEventListener('click', () => {
            this.openPatchToolkit();
            ipcRenderer.send('console-window-close');
        });
        if (this.loggerContent) this.loggerContent.addEventListener('scroll', () => this.handleScroll());
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey) {
                switch (e.key) {
                    case 'l':
                    case 'L':
                        e.preventDefault();
                        this.clearLogs();
                        break;
                    case 's':
                    case 'S':
                        e.preventDefault();
                        this.exportLogs();
                        break;
                }
            }
        });
    }

    setupIpcListeners() {
        ipcRenderer.on('add-log', (event, logData) => this.addLogFromData(logData));
        ipcRenderer.on('clear-logs', () => this.clearLogs());
        ipcRenderer.on('system-info', (event, info) => {
            if (info.hwid) {
                this.hwid = info.hwid;
                this.updateHwidDisplay();
            }
        });
        ipcRenderer.on('apply-dynamic-colors', (event, colors) => this.applyDynamicColors(colors));
        ipcRenderer.on('apply-server-config', (event, config) => {
            if (typeof this.applyServerConfig === 'function') {
                this.applyServerConfig(config);
            }
        });
    }

    async initSystemInfo() {
        try {
            const hwid = await ipcRenderer.invoke('get-hwid');
            if (hwid) {
                this.hwid = hwid;
                this.updateHwidDisplay();
            }
        } catch {}
        const versionInfo = document.getElementById('console-version-info');
        if (versionInfo) {
            try {
                const versionData = await ipcRenderer.invoke('get-version-info');
                let versionText = `v${versionData.version}${versionData.sub_version ? `-${versionData.sub_version}` : ''}`;
                const isOriginalLauncher = await this.checkIfOriginalLauncher();
                if (!isOriginalLauncher && versionData.baseVersionInfo) {
                    const baseInfo = versionData.baseVersionInfo;
                    if (baseInfo.isUndetermined) versionText += ` (Base desconocida)`;
                    else if (!baseInfo.isOfficial) versionText += ` (Base v${baseInfo.version})`;
                }
                versionInfo.textContent = versionText;
            } catch {
                versionInfo.textContent = 'v?.?.?';
            }
        }
    }

    addLogFromData(logData) {
        const { type, args, timestamp, identifier } = logData;
        let message = args.join(' ');
        if (identifier) {
            const identifierTag = `[${identifier}]`;
            if (message.startsWith(identifierTag)) message = message.substring(identifierTag.length).trim();
            else if (message.startsWith(identifierTag + ' ')) message = message.substring(identifierTag.length + 1).trim();
        }
        this.addLog(type, message, timestamp, identifier);
    }

    addLog(level, message, timestamp = null, identifier = null) {
        if (!this.loggerContent) return;
        const now = Date.now();
        const timeSinceLastLog = now - this.lastLogTime;
        if (timeSinceLastLog < this.rapidLogThreshold) {
            this.rapidLogCount++;
            if (this.rapidLogCount > 5) this.skipAnimations = true;
        } else {
            this.rapidLogCount = 0;
            this.skipAnimations = false;
        }
        this.lastLogTime = now;
        const logEntry = {
            level: level || 'info',
            message: message || '',
            timestamp: timestamp || new Date(),
            identifier: identifier
        };
        this.logQueue.push(logEntry);
        if (this.logQueue.length > this.maxQueueSize) this.logQueue = this.logQueue.slice(-this.maxQueueSize);
        if (!this.processingQueue) this.processLogQueue();
    }

    async processLogQueue() {
        this.processingQueue = true;
        while (this.logQueue.length > 0) {
            const batchSize = this.skipAnimations ? this.batchSize : 1;
            const currentBatch = this.logQueue.splice(0, batchSize);
            const fragment = document.createDocumentFragment();
            for (const logEntry of currentBatch) {
                this.logs.push(logEntry);
                const logElement = this.createLogElement(logEntry);
                fragment.appendChild(logElement);
            }
            this.loggerContent.appendChild(fragment);
            if (!this.skipAnimations) {
                if (this.autoScroll) this.scrollToBottom();
                this.updateScrollButton();
                await new Promise(resolve => setTimeout(resolve, 1));
            } else {
                if (currentBatch.length >= this.batchSize) await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        if (this.skipAnimations) {
            if (this.autoScroll) this.scrollToBottom();
            this.updateScrollButton();
        }
        this.processingQueue = false;
    }

    createLogElement(logEntry) {
        const logDiv = document.createElement('div');
        logDiv.className = `log-entry ${logEntry.level}`;
        const timestamp = document.createElement('span');
        timestamp.className = 'log-timestamp';
        timestamp.textContent = `[${new Date(logEntry.timestamp).toLocaleTimeString()}]`;
        const level = document.createElement('span');
        level.className = 'log-level';
        level.textContent = `[${logEntry.level.toUpperCase()}]`;
        const message = document.createElement('span');
        message.className = 'log-message';
        if (logEntry.identifier && !logEntry.message.includes(`[${logEntry.identifier}]`)) {
            message.textContent = `[${logEntry.identifier}] ${logEntry.message}`;
        } else {
            message.textContent = logEntry.message;
        }
        logDiv.appendChild(timestamp);
        logDiv.appendChild(level);
        logDiv.appendChild(message);
        if (!this.skipAnimations) logDiv.style.animation = 'fadeIn 0.2s ease-in';
        return logDiv;
    }

    clearLogs() {
        if (this.loggerContent) this.loggerContent.innerHTML = '';
        this.logs = [];
        this.addLog('info', '[Console] Logs limpiados');
    }

    async exportLogs() {
        try {
            const logsText = this.logs.map(log =>
                `[${new Date(log.timestamp).toISOString()}] [${log.level.toUpperCase()}] ${log.message}`
            ).join('\n');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `console-export-${timestamp}.log`;
            const result = await ipcRenderer.invoke('save-file', {
                filename: filename,
                content: logsText,
                filters: [
                    { name: 'Log Files', extensions: ['log'] },
                    { name: 'Text Files', extensions: ['txt'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });
            if (result.success) this.addLog('info', `[Console] Logs exportados a: ${result.path}`);
        } catch (error) {
            this.addLog('error', `[Console] Error exportando logs: ${error.message}`);
        }
    }

    toggleAutoScroll() {
        this.autoScroll = !this.autoScroll;
        const btn = document.getElementById('toggle-autoscroll-btn');
        if (btn) {
            const icon = btn.querySelector('i');
            if (icon) icon.className = this.autoScroll ? 'fa-solid fa-pause' : 'fa-solid fa-play';
            btn.title = this.autoScroll ? 'Pausar auto-scroll' : 'Activar auto-scroll';
        }
        this.addLog('info', `[Console] Auto-scroll ${this.autoScroll ? 'activado' : 'desactivado'}`);
        if (this.autoScroll) this.scrollToBottom();
    }

    scrollToBottom() {
        if (this.loggerContent) this.loggerContent.scrollTop = this.loggerContent.scrollHeight;
    }

    handleScroll() {
        if (!this.loggerContent || !this.scrollToBottomBtn) return;
        const isAtBottom = this.loggerContent.scrollTop + this.loggerContent.clientHeight >=
            this.loggerContent.scrollHeight - 5;
        if (isAtBottom) this.scrollToBottomBtn.classList.remove('show');
        else this.scrollToBottomBtn.classList.add('show');
    }

    updateScrollButton() {
        if (!this.loggerContent || !this.scrollToBottomBtn) return;
        setTimeout(() => { this.handleScroll(); }, 100);
    }

    updateAutoScrollIcon() {
        const btn = document.getElementById('toggle-autoscroll-btn');
        if (btn) {
            const icon = btn.querySelector('i');
            if (icon) icon.className = this.autoScroll ? 'fa-solid fa-pause' : 'fa-solid fa-play';
            btn.title = this.autoScroll ? 'Pausar auto-scroll' : 'Activar auto-scroll';
        }
    }

    updateHwidDisplay() {
        const hwidElement = document.getElementById('console-hwid');
        if (hwidElement && this.hwid) hwidElement.textContent = this.hwid;
    }

    copyHwid() {
        if (this.hwid) {
            navigator.clipboard.writeText(this.hwid).then(() => {
                this.addLog('info', '[Console] ID de soporte copiado al portapapeles');
            }).catch(() => {
                this.addLog('error', '[Console] Error copiando ID de soporte');
            });
        }
    }

    reportIssue() {
        this.addLog('info', '[Console] Abriendo herramienta de reporte de problemas...');
        ipcRenderer.send('report-issue');
    }

    openPatchToolkit() {
        this.addLog('info', '[Console] Abriendo toolkit de parches...');
        ipcRenderer.send('open-patch-toolkit');
    }

    async checkIfOriginalLauncher() {
        try {
            const versionData = await ipcRenderer.invoke('get-version-info');
            if (versionData.repository && versionData.repository.url) {
                const repoUrl = versionData.repository.url.toLowerCase();
                const normalizedRepoUrl = repoUrl.replace('git+', '').replace('.git', '').replace('http://', 'https://');
                return normalizedRepoUrl.includes('github.com/miguelkix30/miguelkinetworkmclauncher');
            }
            return false;
        } catch {
            return false;
        }
    }

    applyDynamicColors(colors) {
        if (!colors || typeof colors !== 'object') return;
        const root = document.documentElement;
        Object.keys(colors).forEach(property => {
            const value = colors[property];
            if (value) {
                root.style.setProperty(`--${property}`, value);
            }
        });
    }
}

module.exports = ConsoleManager;