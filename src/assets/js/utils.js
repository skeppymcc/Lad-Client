/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

const { ipcRenderer } = require('electron')
const { Status } = require('minecraft-java-core')
const fs = require('fs');
const pkg = require('../package.json');

import config from './utils/config.js';
import database from './utils/database.js';
import logger from './utils/logger.js';
import popup from './utils/popup.js';
import { skin2D } from './utils/skin.js';
import slider from './utils/slider.js';

async function setBackground(theme) {
    let databaseLauncher = new database();
    let configClient;
    if (typeof theme == 'undefined') {
        configClient = await databaseLauncher.readData('configClient');
        theme = configClient?.launcher_config?.theme || "auto"
        theme = await ipcRenderer.invoke('is-dark-theme', theme).then(res => res)
    } else {
        // When called with explicit theme, still fetch config for custom theme
        configClient = await databaseLauncher.readData('configClient');
    }
    let background
    let body = document.body;
    // Preserve existing classes (e.g., streamer-mode)
    let keep = new Set((body.className || '').split(/\s+/).filter(Boolean));
    keep.delete('dark'); keep.delete('light'); keep.delete('global'); keep.delete('custom-theme');
    keep.add(theme ? 'dark' : 'light');
    keep.add('global');
    // Apply custom theme class if enabled
    const custom = configClient?.launcher_config?.custom_theme;
    if (custom?.enabled) keep.add('custom-theme');
    body.className = Array.from(keep).join(' ');

    // Apply custom CSS variables if enabled
    if (custom?.enabled) {
        const root = document.documentElement;
        try {
            root.style.setProperty('--color', custom.color || '#F5F5F5');
            root.style.setProperty('--background', custom.background || '#292929');
            root.style.setProperty('--background-element', custom.backgroundElement || '#424242');
            root.style.setProperty('--background-transparent', custom.backgroundTransparent || 'rgba(44,44,44,0.8)');
            root.style.setProperty('--element-color', custom.elementColor || '#0078bd');
        } catch (_) {}
    } else {
        // Clear inline overrides to fall back to theme.css
        const root = document.documentElement;
        ['--color','--background','--background-element','--background-transparent','--element-color']
            .forEach(v => { try { root.style.removeProperty(v); } catch(_){} });
    }
    if (fs.existsSync(`${__dirname}/assets/images/background/easterEgg`) && Math.random() < 0.005) {
        let backgrounds = fs.readdirSync(`${__dirname}/assets/images/background/easterEgg`);
        let Background = backgrounds[Math.floor(Math.random() * backgrounds.length)];
        background = `url(./assets/images/background/easterEgg/${Background})`;
    } else if (fs.existsSync(`${__dirname}/assets/images/background/${theme ? 'dark' : 'light'}`)) {
        let backgrounds = fs.readdirSync(`${__dirname}/assets/images/background/${theme ? 'dark' : 'light'}`);
        let Background = backgrounds[Math.floor(Math.random() * backgrounds.length)];
        background = `linear-gradient(#00000080, #00000080), url(./assets/images/background/${theme ? 'dark' : 'light'}/${Background})`;
    }
    body.style.backgroundImage = background ? background : theme ? '#000' : '#fff';
    body.style.backgroundSize = 'cover';
}

async function changePanel(id) {
    let panel = document.querySelector(`.${id}`);
    if (!panel) {
        console.warn(`changePanel: panel '.${id}' not found`);
        return;
    }
    let active = document.querySelector(`.active`);
    if (active) active.classList.toggle("active");
    panel.classList.add("active");
}

async function appdata() {
    return await ipcRenderer.invoke('appData').then(path => path)
}

async function addAccount(data) {
    let skin = false
    if (data?.profile?.skins[0]?.base64) skin = await new skin2D().creatHeadTexture(data.profile.skins[0].base64);
    let div = document.createElement("div");
    div.classList.add("account");
    div.id = data.ID;
    div.innerHTML = `
        <div class="profile-image" ${skin ? 'style="background-image: url(' + skin + ');"' : ''}></div>
        <div class="profile-infos">
            <div class="profile-pseudo">${data.name}</div>
            <div class="profile-uuid">${data.uuid}</div>
        </div>
        <div class="delete-profile" id="${data.ID}">
            <div class="icon-account-delete delete-profile-icon"></div>
        </div>
    `
    return document.querySelector('.accounts-list').appendChild(div);
}

async function accountSelect(data) {
    let account = document.getElementById(`${data.ID}`);
    let activeAccount = document.querySelector('.account-select')

    if (activeAccount) activeAccount.classList.toggle('account-select');
    account.classList.add('account-select');
    if (data?.profile?.skins[0]?.base64) headplayer(data.profile.skins[0].base64);
}

async function headplayer(skinBase64) {
    let skin = await new skin2D().creatHeadTexture(skinBase64);
    document.querySelector(".player-head").style.backgroundImage = `url(${skin})`;
}

async function setStatus(opt) {
    let nameServerElement = document.querySelector('.server-status-name')
    let statusServerElement = document.querySelector('.server-status-text')
    let playersOnline = document.querySelector('.status-player-count .player-count')

    if (!opt) {
        statusServerElement.classList.add('red')
        statusServerElement.innerHTML = `Instancia Actual - 0 ms`
        document.querySelector('.status-player-count').classList.add('red')
        playersOnline.innerHTML = '0'
        return
    }

    let { ip, port, nameServer } = opt
    nameServerElement.innerHTML = nameServer
    let status = new Status(ip, port);
    let statusServer = await status.getStatus().then(res => res).catch(err => err);

    if (!statusServer.error) {
        statusServerElement.classList.remove('red')
        document.querySelector('.status-player-count').classList.remove('red')
        statusServerElement.innerHTML = `Instancia Actual - ${statusServer.ms} ms`
        playersOnline.innerHTML = statusServer.playersConnect
    } else {
        statusServerElement.classList.add('red')
        statusServerElement.innerHTML = `Instancia Actual - 0 ms`
        document.querySelector('.status-player-count').classList.add('red')
        playersOnline.innerHTML = '0'
    }
}


export {
    appdata as appdata,
    changePanel as changePanel,
    config as config,
    database as database,
    logger as logger,
    popup as popup,
    setBackground as setBackground,
    skin2D as skin2D,
    addAccount as addAccount,
    accountSelect as accountSelect,
    slider as Slider,
    pkg as pkg,
    setStatus as setStatus
}

// Global Streamer Mode utilities
// Provides consistent behavior across panels without relying on settings.js load order
;(function initStreamerModeGlobal(){
    if (typeof window === 'undefined') return;
    if (!window.StreamerMode) {
        window.StreamerMode = {
            enabled: false,
            observer: null,
            sanitize(root=document) {
                if (!this.enabled || !root) return;
                const textSelectors = [
                    '.profile-pseudo', '.profile-uuid', '.account-select',
                    '.instance-name', '.add-text-profile', '.player-count',
                    '.server-status-name', '.server-status-text', '.session-info-value'
                ];
                const bgSelectors = ['.profile-image', '.player-head'];

                textSelectors.forEach(sel => {
                    root.querySelectorAll(sel).forEach(el => { try { el.textContent = 'Streamer'; } catch(_){} });
                });
                bgSelectors.forEach(sel => {
                    root.querySelectorAll(sel).forEach(el => { try { el.style.background = '#a78bfa'; } catch(_){} });
                });
                // Mask current notification texts
                root.querySelectorAll('.notification-message').forEach(el => { try { el.textContent = 'Modo Streaming Activado'; } catch(_){} });
            },
            startObserver(){
                if (this.observer) return;
                try {
                    this.observer = new MutationObserver(muts => {
                        if (!this.enabled) return;
                        for (const m of muts) {
                            if (m.type === 'childList') {
                                m.addedNodes && m.addedNodes.forEach(n => {
                                    if (n.nodeType === 1) this.sanitize(n);
                                });
                            } else if (m.type === 'attributes') {
                                if (m.target && m.target.nodeType === 1) this.sanitize(m.target);
                            }
                        }
                    });
                    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true });
                } catch(_) {}
            },
            stopObserver(){
                try { this.observer?.disconnect(); } catch(_) {}
                this.observer = null;
            }
        }
    }

    // Idempotent global toggler
    window.applyStreamerMode = function(enabled){
        enabled = !!enabled;
        window.StreamerMode.enabled = enabled;
        if (enabled) {
            document.body.classList.add('streamer-mode');
            window.StreamerMode.sanitize(document);
            window.StreamerMode.startObserver();
        } else {
            document.body.classList.remove('streamer-mode');
            window.StreamerMode.stopObserver();
            // No restoration of sensitive text by design
        }
        // Broadcast change so panels can react if needed
        try { window.dispatchEvent(new CustomEvent('streamer-mode-changed', { detail: { enabled } })); } catch(_) {}
    }
})();
