/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

const { ipcRenderer, shell } = require('electron');
const pkg = require('../package.json');
const os = require('os');
import { config, database } from './utils.js';
const nodeFetch = require("node-fetch");


class Splash {
    constructor() {
        // Inicializar una vez cargado el DOM para evitar referencias null
        document.addEventListener('DOMContentLoaded', async () => {
            // seleccionar nodos del DOM (compat con la nueva estructura del splash)
            this.splashRoot = document.getElementById('splash');
            this.splashCard = document.querySelector('.splash-card');
            this.splashIcon = document.querySelector('.splash-icon');
            this.splashMessage = document.querySelector('.splash-message');
            this.splashAuthor = document.querySelector('.splash-author');
            this.statusEl = document.getElementById('splash-status') || document.querySelector('.message');
            this.progress = document.getElementById('splash-progress') || document.querySelector('.progress');
            this.percentEl = document.getElementById('splash-percent') || null;

            let databaseLauncher = new database();
            let configClient = await databaseLauncher.readData('configClient');
            let theme = configClient?.launcher_config?.theme || "auto"
            let isDarkTheme = await ipcRenderer.invoke('is-dark-theme', theme).then(res => res)
            document.body.className = isDarkTheme ? 'dark global' : 'light global';
            if (process.platform == 'win32') ipcRenderer.send('update-window-progress-load')
            this.startAnimation()
        });
    }

    async startAnimation() {
        let splashes = [
            { "message": "", "author": "" },
            { "message": "", "author": "" },
            { "message": "", "author": "" }
        ];
        let splash = splashes[Math.floor(Math.random() * splashes.length)];
        if (this.splashMessage) try { this.splashMessage.textContent = splash.message; } catch(_) {}
        if (this.splashAuthor && this.splashAuthor.children && this.splashAuthor.children[0]) try { this.splashAuthor.children[0].textContent = "@" + splash.author; } catch(_) {}
        await sleep(100);
        if (this.splashRoot) this.splashRoot.style.display = "block";
        await sleep(500);
        if (this.splashCard && this.splashCard.classList) this.splashCard.classList.add("opacity");
        await sleep(500);
        if (this.splashIcon && this.splashIcon.classList) this.splashIcon.classList.add("translate");
        if (this.splashMessage && this.splashMessage.classList) this.splashMessage.classList.add("opacity");
        if (this.splashAuthor && this.splashAuthor.classList) this.splashAuthor.classList.add("opacity");
        if (this.statusEl && this.statusEl.classList) this.statusEl.classList.add("opacity");
        await sleep(1000);
        this.checkUpdate();
    }

    async checkUpdate() {
        this.setStatus(`Buscando actualizaciones...`);

        ipcRenderer.invoke('update-app').then().catch(err => {
            return this.shutdown(`Error al buscar actualizaciones:<br>${err.message}`);
        });

        ipcRenderer.on('updateAvailable', () => {
            this.setStatus(`Actualización disponible`);
            if (os.platform() == 'win32') {
                this.toggleProgress();
                ipcRenderer.send('start-update');
            }
            else return this.dowloadUpdate();
        })

        ipcRenderer.on('error', (event, err) => {
            if (err) return this.shutdown(`${err.message}`);
        })

        ipcRenderer.on('download-progress', (event, progress) => {
            ipcRenderer.send('update-window-progress', { progress: progress.transferred, size: progress.total })
            this.setProgress(progress.transferred, progress.total);
        })

        ipcRenderer.on('update-not-available', () => {
            console.error("Actualización no disponible");
            this.maintenanceCheck();
        })
    }

    getLatestReleaseForOS(os, preferredFormat, asset) {
        return asset.filter(asset => {
            const name = asset.name.toLowerCase();
            const isOSMatch = name.includes(os);
            const isFormatMatch = name.endsWith(preferredFormat);
            return isOSMatch && isFormatMatch;
        }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    }

    async dowloadUpdate() {
        const repoURL = pkg.repository.url.replace("git+", "").replace(".git", "").replace("https://github.com/", "").split("/");
        const githubAPI = await nodeFetch('https://api.github.com').then(res => res.json()).catch(err => err);

        const githubAPIRepoURL = githubAPI.repository_url.replace("{owner}", repoURL[0]).replace("{repo}", repoURL[1]);
        const githubAPIRepo = await nodeFetch(githubAPIRepoURL).then(res => res.json()).catch(err => err);

        const releases_url = await nodeFetch(githubAPIRepo.releases_url.replace("{/id}", '')).then(res => res.json()).catch(err => err);
        const latestRelease = releases_url[0].assets;
        let latest;

        if (os.platform() == 'darwin') latest = this.getLatestReleaseForOS('mac', '.dmg', latestRelease);
        else if (os == 'linux') latest = this.getLatestReleaseForOS('linux', '.appimage', latestRelease);


        this.setStatus(`Actualización disponible<br><div class="download-update">Descargar</div>`);
        document.querySelector(".download-update").addEventListener("click", () => {
            shell.openExternal(latest.browser_download_url);
            return this.shutdown("Descargando...");
        });
    }


    async maintenanceCheck() {
        config.GetConfig().then(res => {
            if (res.maintenance) return this.shutdown(res.maintenance_message);
            this.startLauncher();
        }).catch(e => {
            console.error(e);
            return this.shutdown("No se ha podido conectar al servidor.<br>Por favor, inténtalo más tarde.");
        })
    }

    startLauncher() {
        this.setStatus(`Iniciando launcher`);
        ipcRenderer.send('main-window-open');
        ipcRenderer.send('update-window-close');
    }

    shutdown(text) {
        this.setStatus(`${text}<br>Cerrando en 5s`);
        let i = 4;
        setInterval(() => {
            this.setStatus(`${text}<br>Cerrando en ${i--}s`);
            if (i < 0) ipcRenderer.send('update-window-close');
        }, 1000);
    }

    setStatus(text) {
        if (this.statusEl) this.statusEl.innerHTML = text;
    }

    toggleProgress() {
        if (!this.progress) return;
        if (this.progress.classList.toggle("show")) this.setProgress(0, 1);
    }

    setProgress(value, max) {
        if (!this.progress) return;
        this.progress.value = value;
        this.progress.max = max;
        if (this.percentEl && Number(max) > 0) {
            const pct = Math.round((Number(value) / Number(max)) * 100);
            this.percentEl.textContent = `${pct}%`;
        } else if (this.percentEl && Number(max) === 0) {
            this.percentEl.textContent = '';
        }
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// Bloquear atajos durante splash para prevenir apertura de devtools
document.addEventListener("keydown", (e) => {
    const code = e.keyCode;
    const ctrlShift = e.ctrlKey && e.shiftKey;
    if (code === 123 || (ctrlShift && [73,74,67,75,80].includes(code))) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return false;
    }
    // permitir envíos a devtools sólo en modo desarrollo controlado
    if ((process.env.DEV_TOOL === 'open' || process.env.NODE_ENV === 'dev') && (ctrlShift && code === 73 || code === 123)) {
        try { ipcRenderer.send("update-window-dev-tools"); } catch (_) {}
    }
}, { capture: true });
// Bloquear menú contextual en splash
window.addEventListener('contextmenu', e => { e.preventDefault(); return false; }, { capture: true });

new Splash();