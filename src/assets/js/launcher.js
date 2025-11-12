/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */
// import panel
import Login from './panels/login.js';
import Home from './panels/home.js';
import Settings from './panels/settings.js';

// import modules
import { logger, config, changePanel, database, popup, setBackground, accountSelect, addAccount, pkg } from './utils.js';
const { AZauth, Microsoft, Mojang } = require('minecraft-java-core');

// libs
const { ipcRenderer } = require('electron');
const fs = require('fs');
const os = require('os');

class Launcher {
    async init() {
        // Exponer instancia global para acceso por otros módulos (home.js)
        window._launcherInstance = this;
        this.initLog();
        console.log('Iniciando Cliente...');
        this.shortcut()
        await setBackground()
        this.initFrame();
        this.config = await config.GetConfig().then(res => res).catch(err => err);
        if (await this.config.error) return this.errorConnect()
        this.db = new database();
        await this.initConfigClient();
        this.createPanels(Login, Home, Settings);
        this.startLauncher();
    }

    initLog() {
        // Bloquear atajos que puedan abrir devtools; F12 abre la consola custom
        document.addEventListener('keydown', (e) => {
            const code = e.keyCode;
            const ctrlShift = e.ctrlKey && e.shiftKey;
            const devCombos = ctrlShift && [73,74,67,75,80].includes(code); // I, J, C, K, P

            // F12 -> toggle custom console
            if (code === 123) {
                e.preventDefault();
                e.stopImmediatePropagation();
                try { this.toggleCustomConsole(); } catch (_) {}
                return false;
            }

            // bloquear otras combinaciones que podrían abrir herramientas
            if (devCombos || (e.ctrlKey && e.key === 'F12')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                return false;
            }

            // En modo desarrollo controlado permitir abrir devtools vía IPC
            if ((process.env.DEV_TOOL === 'open' || process.env.NODE_ENV === 'dev') && (ctrlShift && code === 73)) {
                ipcRenderer.send('main-window-dev-tools-close');
                ipcRenderer.send('main-window-dev-tools');
            }
        }, { capture: true });

        // Desactivar menú contextual para evitar "inspeccionar elemento"
        window.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            return false;
        }, { capture: true });

        // inicializar logger y la consola proxy
        new logger(pkg.name, '#7289da')
        try { this.setupConsoleProxy(); } catch (_) {}

        // Exportar API mínima para escribir en la consola (read-only)
        window.customConsoleLog = (level, text) => {
            try {
                // asegurar que la instancia existe
                const inst = window._launcherInstance;
                if (!inst) return;
                if (!inst._consoleCreated) inst.createCustomConsole();
                inst.appendCustomConsoleMessage(level, String(text || ''));
            } catch (_) {}
        };
    }

    // --- Consola custom ---
    setupConsoleProxy() {
        // guardar originales
        this._origConsole = {
            log: console.log.bind(console),
            info: console.info.bind(console),
            warn: console.warn.bind(console),
            error: console.error.bind(console)
        };
        // duplicar salidas hacia la consola custom si existe
        console.log = (...args) => {
            this._origConsole.log(...args);
            try { this.appendCustomConsoleMessage('log', args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')); } catch (_) {}
        };
        console.info = (...args) => {
            this._origConsole.info(...args);
            try { this.appendCustomConsoleMessage('info', args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')); } catch (_) {}
        };
        console.warn = (...args) => {
            this._origConsole.warn(...args);
            try { this.appendCustomConsoleMessage('warn', args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')); } catch (_) {}
        };
        console.error = (...args) => {
            this._origConsole.error(...args);
            try { this.appendCustomConsoleMessage('error', args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')); } catch (_) {}
        };
    }

    createCustomConsole() {
        // Read-only console: no campo de entrada, solo botones Clear/Close
        if (this._consoleCreated) return;
        this._consoleCreated = true;
        const root = document.createElement('div');
        root.className = 'custom-console hidden';
        root.innerHTML = `
            <div class="custom-console-shell" role="dialog" aria-label="Consola Lad">
                <div class="custom-console-header">
                    <div class="title">Consola — Lad</div>
                    <div class="controls">
                        <button class="console-clear" title="Limpiar">Limpiar</button>
                        <button class="console-close" title="Cerrar">Cerrar</button>
                    </div>
                </div>
                <div class="custom-console-body" tabindex="0" role="log" aria-live="polite" aria-atomic="false"></div>
            </div>`;
        document.body.appendChild(root);

        this._consoleRoot = root;
        this._consoleBody = root.querySelector('.custom-console-body');
        root.querySelector('.console-close').addEventListener('click', () => this.toggleCustomConsole(false));
        root.querySelector('.console-clear').addEventListener('click', () => { this._consoleBody.innerHTML = ''; });
        // Close on Escape when visible
        document.addEventListener('keydown', (e) => {
            if ((e.key === 'Escape') && this._consoleCreated && this._consoleRoot.classList.contains('visible')) {
                this.toggleCustomConsole(false);
            }
        });
    }

    toggleCustomConsole(force) {
        const root = this._consoleRoot;
        const isHidden = root.classList.contains('hidden');
        const show = typeof force === 'boolean' ? force : isHidden;
        if (show) {
            root.classList.remove('hidden');
            root.classList.add('visible');
            setTimeout(() => root.querySelector('.custom-console-input')?.focus(), 120);
        } else {
            root.classList.remove('visible');
            root.classList.add('hidden');
        }
    }

    appendCustomConsoleMessage(level, text) {
        if (!this._consoleCreated) return;
        const entry = document.createElement('div');
        entry.className = `console-entry console-${level}`;
        const time = new Date().toLocaleTimeString();
        entry.innerHTML = `<span class="t">${time}</span><span class="m">${String(text)}</span>`;
        // subtle animation
        entry.style.opacity = '0';
        entry.style.transform = 'translateY(6px)';
        this._consoleBody.appendChild(entry);
        requestAnimationFrame(() => {
            entry.style.transition = 'opacity 180ms ease, transform 180ms ease';
            entry.style.opacity = '1';
            entry.style.transform = 'translateY(0)';
        });
        this._consoleBody.scrollTop = this._consoleBody.scrollHeight + 9999;
        // cap entries
        const max = 500;
        while (this._consoleBody.children.length > max) this._consoleBody.removeChild(this._consoleBody.firstChild);
    }

    shortcut() {
        document.addEventListener('keydown', e => {
            if (e.ctrlKey && e.keyCode == 87) {
                ipcRenderer.send('main-window-close');
            }
        })
    }


    errorConnect() {
        new popup().openPopup({
            title: this.config.error.code,
            content: this.config.error.message,
            color: 'red',
            exit: true,
            options: true
        });
    }

    initFrame() {
        console.log('Iniciando Frame...')
        const platform = os.platform() === 'darwin' ? "darwin" : "other";

        // Enlazar controles de ventana (solo minimizar y cerrar). No existe botón maximizar.
        try {
            const btnMinimize = document.getElementById('minimize');
            const btnClose = document.getElementById('close');

            if (btnMinimize) {
                btnMinimize.addEventListener('click', () => {
                    ipcRenderer.send('main-window-minimize');
                });
                btnMinimize.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ipcRenderer.send('main-window-minimize'); }}); 
            }

            if (btnClose) {
                // Mostrar popup de cierre durante 3s antes de cerrar (para que el usuario lo vea)
                btnClose.addEventListener('click', () => {
                    try {
                        const p = new popup();
                        p.openPopup({
                            title: 'Cerrando...',
                            content: 'Saliendo del launcher. Se cerrará en unos segundos...',
                            color: 'var(--color)',
                            background: false
                        });
                        setTimeout(() => {
                            ipcRenderer.send('main-window-close');
                        }, 3000);
                    } catch (err) {
                        // fallback: si algo falla, cerrar inmediatamente
                        ipcRenderer.send('main-window-close');
                    }
                });
                btnClose.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        try {
                            const p = new popup();
                            p.openPopup({
                                title: 'Cerrando...',
                                content: 'Saliendo del launcher. Se cerrará en unos segundos...',
                                color: 'var(--color)',
                                background: false
                            });
                            setTimeout(() => {
                                ipcRenderer.send('main-window-close');
                            }, 3000);
                        } catch (err) {
                            ipcRenderer.send('main-window-close');
                        }
                    }
                });
            }
        } catch (e) {
            console.warn('initFrame - window controls bind failed', e);
        }
    }

    async initConfigClient() {
        console.log('Iniciando Config Client...')
        let configClient = await this.db.readData('configClient')

        if (!configClient) {
            await this.db.createData('configClient', {
                account_selected: null,
                instance_selct: null,
                java_config: {
                    java_path: null,
                    java_memory: {
                        min: 2,
                        max: 4
                    }
                },
                game_config: {
                    screen_size: {
                        width: 854,
                        height: 480
                    }
                },
                launcher_config: {
                    download_multi: 5,
                    theme: 'dark',
                    closeLauncher: 'close-launcher',
                    intelEnabledMac: true,
                    streamer_mode: false,
                    discord_rpc: {
                        enabled: true,
                        buttons: [
                            { label: 'Discord', url: 'https://discord.gg/pkJ4evmy' },
                            { label: 'Sitio Web', url: 'https://Ladcreators.com' }
                        ]
                    },
                    custom_theme: {
                        enabled: false,
                        color: '#F5F5F5',
                        background: '#292929',
                        backgroundElement: '#424242',
                        backgroundTransparent: 'rgba(44,44,44,0.8)',
                        elementColor: '#0078bd'
                    }
                }
            })
        }
    }

    createPanels(...panels) {
        let panelsElem = document.querySelector('.panels')
        for (let panel of panels) {
            console.log(`Iniciando el panel ${panel.name}...`);
            let div = document.createElement('div');
            div.classList.add('panel', panel.id)
            div.innerHTML = fs.readFileSync(`${__dirname}/panels/${panel.id}.html`, 'utf8');
            panelsElem.appendChild(div);
            new panel().init(this.config);
        }
    }

    async startLauncher() {
        let accounts = await this.db.readAllData('accounts')
        let configClient = await this.db.readData('configClient')
        let account_selected = configClient ? configClient.account_selected : null
        let popupRefresh = new popup();

        if (accounts?.length) {
            for (let account of accounts) {
                let account_ID = account.ID
                if (account.error) {
                    await this.db.deleteData('accounts', account_ID)
                    continue
                }
                if (account.meta.type === 'Xbox') {
                    console.log(`Tipo de cuenta: ${account.meta.type} | Username: ${account.name}`);
                    popupRefresh.openPopup({
                        title: 'Cargando Cuenta...',
                        content: `Tipo de cuenta: ${account.meta.type} | Username: ${account.name}`,
                        color: 'var(--color)',
                        background: false
                    });

                    let refresh_accounts = await new Microsoft(this.config.client_id).refresh(account);

                    if (refresh_accounts.error) {
                        await this.db.deleteData('accounts', account_ID)
                        if (account_ID == account_selected) {
                            configClient.account_selected = null
                            await this.db.updateData('configClient', configClient)
                        }
                        console.error(`[Account] ${account.name}: ${refresh_accounts.errorMessage}`);
                        continue;
                    }

                    refresh_accounts.ID = account_ID
                    await this.db.updateData('accounts', refresh_accounts, account_ID)
                    await addAccount(refresh_accounts)
                    if (account_ID == account_selected) accountSelect(refresh_accounts)
                } else if (account.meta.type == 'AZauth') {
                    console.log(`Tipo de cuenta: ${account.meta.type} | Username: ${account.name}`);
                    popupRefresh.openPopup({
                        title: 'Cargando Cuenta...',
                        content: `Tipo de cuenta: ${account.meta.type} | Username: ${account.name}`,
                        color: 'var(--color)',
                        background: false
                    });
                    let refresh_accounts = await new AZauth(this.config.online).verify(account);

                    if (refresh_accounts.error) {
                        this.db.deleteData('accounts', account_ID)
                        if (account_ID == account_selected) {
                            configClient.account_selected = null
                            this.db.updateData('configClient', configClient)
                        }
                        console.error(`[Account] ${account.name}: ${refresh_accounts.message}`);
                        continue;
                    }

                    refresh_accounts.ID = account_ID
                    this.db.updateData('accounts', refresh_accounts, account_ID)
                    await addAccount(refresh_accounts)
                    if (account_ID == account_selected) accountSelect(refresh_accounts)
                } else if (account.meta.type == 'Mojang') {
                    console.log(`Tipo de cuenta: ${account.meta.type} | Username: ${account.name}`);
                    popupRefresh.openPopup({
                        title: 'Cargando Cuenta...',
                        content: `Tipo de cuenta: ${account.meta.type} | Username: ${account.name}`,
                        color: 'var(--color)',
                        background: false
                    });
                    if (account.meta.online == false) {
                        let refresh_accounts = await Mojang.login(account.name);

                        refresh_accounts.ID = account_ID
                        await addAccount(refresh_accounts)
                        this.db.updateData('accounts', refresh_accounts, account_ID)
                        if (account_ID == account_selected) accountSelect(refresh_accounts)
                        continue;
                    }

                    let refresh_accounts = await Mojang.refresh(account);

                    if (refresh_accounts.error) {
                        this.db.deleteData('accounts', account_ID)
                        if (account_ID == account_selected) {
                            configClient.account_selected = null
                            this.db.updateData('configClient', configClient)
                        }
                        console.error(`[Account] ${account.name}: ${refresh_accounts.errorMessage}`);
                        continue;
                    }

                    refresh_accounts.ID = account_ID
                    this.db.updateData('accounts', refresh_accounts, account_ID)
                    await addAccount(refresh_accounts)
                    if (account_ID == account_selected) accountSelect(refresh_accounts)
                } else {
                    console.error(`[Account] ${account.name}: Account Type Not Found`);
                    this.db.deleteData('accounts', account_ID)
                    if (account_ID == account_selected) {
                        configClient.account_selected = null
                        this.db.updateData('configClient', configClient)
                    }
                }
            }

            accounts = await this.db.readAllData('accounts')
            configClient = await this.db.readData('configClient')
            account_selected = configClient ? configClient.account_selected : null

            if (!account_selected) {
                let uuid = accounts[0].ID
                if (uuid) {
                    configClient.account_selected = uuid
                    await this.db.updateData('configClient', configClient)
                    accountSelect(uuid)
                }
            }

            if (!accounts.length) {
                config.account_selected = null
                await this.db.updateData('configClient', config);
                popupRefresh.closePopup()
                document.querySelector(".preload-content").style.display = "none";
                return changePanel("login");
            }

            popupRefresh.closePopup()
            changePanel("home");
            document.querySelector(".preload-content").style.display = "none";
        } else {
            popupRefresh.closePopup()
            changePanel('login');
            document.querySelector(".preload-content").style.display = "none";
        }
    }
}

new Launcher().init();
