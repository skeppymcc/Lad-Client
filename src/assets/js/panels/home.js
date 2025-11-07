/**
 * @author ElFo2Ks
 */
import { config, database, logger, changePanel, appdata, setStatus, pkg } from '../utils.js'

const { Launch } = require('minecraft-java-core')
const { shell, ipcRenderer } = require('electron')

window._pendingNotifications = window._pendingNotifications || [];
window._activeNotifications = window._activeNotifications || [];
window._notificationTimeouts = window._notificationTimeouts || [];
window._maxNotifications = 3;

// Limpia todas las notificaciones y timeouts (para evitar congelamientos)
window.clearAllNotifications = function() {
    window._pendingNotifications = [];
    window._activeNotifications = [];
    window._notificationTimeouts.forEach(t => clearTimeout(t));
    window._notificationTimeouts = [];
    const homePanel = document.querySelector('.home');
    if (homePanel) {
        const container = homePanel.querySelector('.notification-container');
        if (container) container.innerHTML = '';
    }
};

// Nueva función para mostrar la siguiente notificación de la cola
window._showNextNotification = function() {
    if (window._activeNotifications.length >= window._maxNotifications) return;
    if (!window._pendingNotifications.length) return;

    const notifData = window._pendingNotifications.shift();
    const homePanel = document.querySelector('.home');
    if (!homePanel) return;

    let container = homePanel.querySelector('.notification-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'notification-container';
        homePanel.appendChild(container);
    }

    // Icono verde check pequeño
    const iconSVG = `<svg class="notification-icon" viewBox="0 0 24 24" width="18" height="18"><rect width="24" height="24" rx="7" fill="#00e676"/><path d="M7 13l3 3 7-7" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    const notif = document.createElement('div');
    notif.className = `notification notification-${notifData.type} notification-animate-in notification-mini`;
    notif.innerHTML = `
        <span class="notification-icon-wrapper">${iconSVG}</span>
        <span class="notification-message">${notifData.message}</span>
        <button class="notification-close" title="Cerrar">&times;</button>
    `;
    container.appendChild(notif);
    window._activeNotifications.push(notif);

    // Cierre manual
    notif.querySelector('.notification-close').onclick = () => {
        window._removeNotification(notif);
    };

    // Timeout de cierre automático
    const timeout = setTimeout(() => {
        window._removeNotification(notif);
    }, notifData.timeout || 2200);
    window._notificationTimeouts.push(timeout);

    // Si hay más en cola y espacio, mostrar la siguiente tras un pequeño delay
    if (window._pendingNotifications.length > 0 && window._activeNotifications.length < window._maxNotifications) {
        setTimeout(window._showNextNotification, 200);
    }
};

// Elimina una notificación y muestra la siguiente de la cola si hay espacio
window._removeNotification = function(notif) {
    if (!notif) return;
    notif.classList.remove('notification-animate-in');
    notif.classList.add('notification-animate-out');
    notif.addEventListener('animationend', () => {
        notif.remove();
        window._activeNotifications = window._activeNotifications.filter(n => n !== notif);
        // Mostrar la siguiente si hay espacio
        if (window._pendingNotifications.length > 0) {
            window._showNextNotification();
        }
    }, { once: true });
};

// Notificación pública (usa la cola)
window.notify = function({ message, type = "info", timeout = 2200 }) {
    // Si no estamos en home, guarda la notificación para mostrarla luego
    const homePanel = document.querySelector('.home');
    const instancePopup = document.querySelector('.instance-popup');
    if (!homePanel || (instancePopup && instancePopup.style.display === 'flex')) {
        window._pendingNotifications.push({ message, type, timeout });
        return;
    }
    window._pendingNotifications.push({ message, type, timeout });
    // Si hay espacio, mostrar la siguiente
    if (window._activeNotifications.length < window._maxNotifications) {
        window._showNextNotification();
    }
};

// Mostrar notificaciones pendientes al volver a home
function showPendingNotifications() {
    if (!window._pendingNotifications || !window._pendingNotifications.length) return;
    setTimeout(() => {
        // Solo mostrar si estamos en home y no en instancias
        const homePanel = document.querySelector('.home');
        const instancePopup = document.querySelector('.instance-popup');
        if (!homePanel || (instancePopup && instancePopup.style.display === 'flex')) return;
        // Si hay espacio, mostrar las pendientes
        while (window._pendingNotifications.length && window._activeNotifications.length < window._maxNotifications) {
            window._showNextNotification();
        }
    }, 200); // pequeño delay para asegurar que el DOM está listo
}

// Hook para mostrar notificaciones pendientes al volver a home
document.addEventListener('panelChanged', function(e) {
    if (e.detail && e.detail.panel === 'home') {
        showPendingNotifications();
    }
});

// Si usas changePanel, dispara el evento personalizado
const origChangePanel = window.changePanel || changePanel;
window.changePanel = function(panel, ...args) {
    // Limpia notificaciones al cambiar de panel (opcional, mejora UX)
    window.clearAllNotifications();
    const result = origChangePanel.apply(this, [panel, ...args]);
    const event = new CustomEvent('panelChanged', { detail: { panel } });
    document.dispatchEvent(event);
    return result;
};

class Home {
    static id = "home";
    constructor() {
        // Reproductor de música único
        this.musicPlayer = new Audio();
        this.musicPlayer.loop = true;
        this.musicPlayer.volume = 0.4;
        this.musicEnabled = true; // por defecto
        this.currentMusicUrl = null;

        // Nueva bandera: true mientras se está iniciando/ejecutando una instancia
        this.launching = false;

        // Nuevo: control del contador de minutos jugados
        this.playTimerId = null;
        this.playedMinutes = parseInt(localStorage.getItem('playedMinutes') || '0', 10) || 0;

        // Exponer referencia a la instancia actual para refrescos externos
        try { window._homeInstance = this; } catch (e) {}

        // Flag para evitar atachar múltiples veces el handler del botón JUGAR
        this._playHandlersAttached = false;
    }

    async init(config) {
        this.config = config;
        this.db = new database();
        await this.initMusicPlayer();
        this.news()
        this.socialLick()

        // Conectar el botón lateral de refresco (si existe en el DOM)
        try {
            const sidebarRefreshBtn = document.querySelector('.refresh-btn');
            if (sidebarRefreshBtn) {
                const runRefresh = async (e) => {
                    if (e && e.preventDefault) e.preventDefault();
                    window.notify({ message: "Actualizando launcher...", type: "info", timeout: 1200 });
                    try {
                        if (window._homeInstance && typeof window._homeInstance.refreshLauncherResources === 'function') {
                            await window._homeInstance.refreshLauncherResources();
                        } else if (typeof window.refreshLauncher === 'function') {
                            await window.refreshLauncher();
                        }
                    } catch (err) {
                        console.error('refresh launcher failed', err);
                    }
                };
                sidebarRefreshBtn.addEventListener('click', runRefresh);
                sidebarRefreshBtn.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); runRefresh(e); }
                });
            }
        } catch (e) { console.warn('could not bind sidebar refresh button', e); }

        await this.instancesSelect()
        await this.loadInstanceMenuTemplate(); // <-- carga el html del menú
        this.IniciarEstadoDiscord();
        // Asegurar que el botón "JUGAR" tenga su handler (solo una vez)
        try { this._attachPlayHandlers(); } catch (e) { console.warn('attachPlayHandlers failed', e); }

        this.initSessionInfo();
        // inicializar handlers para mostrar overlay con el nombre de la cuenta al pasar por .head-frame
        try { this.initAccountPreviewHandlers(); } catch (e) { console.warn('account preview init failed', e); }
        
        window.notify({ message: "Bienvenido al launcher.", type: "success", timeout: 1800 });

        // --- Popup agregar instancia minimalista ---
        const addBtn = document.querySelector('.add-instance-btn');
        const popup = document.querySelector('.add-instance-popup');
        const input = document.querySelector('.add-instance-input');
        const confirm = document.querySelector('.add-instance-confirm');
        const cancel = document.querySelector('.add-instance-cancel');

        function openAddInstancePopup() {
            if (!popup) return;
            popup.classList.add('show');
            document.body.classList.add('add-instance-open');
            input.value = '';
            input.focus();
        }
        function closeAddInstancePopup() {
            if (!popup) return;
            popup.classList.remove('show');
            document.body.classList.remove('add-instance-open');
            input.value = '';
        }

        if (addBtn && popup && input && confirm && cancel) {
            addBtn.addEventListener('click', openAddInstancePopup);
            cancel.addEventListener('click', closeAddInstancePopup);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') confirm.click();
                if (e.key === 'Escape') cancel.click();
            });

            confirm.addEventListener('click', async () => {
                const code = input.value.trim();
                if (!code) {
                    window.notify({ message: "Introduce un código válido.", type: "error" });
                    return;
                }

                window.notify({ message: "Comprobando código...", type: "info", timeout: 3000 });
                try {
                    const url = `https://23.150.24.124:25513/api/checkInstanceCode.php?code=${encodeURIComponent(code)}`;
                    const res = await fetch(url, { method: 'GET' });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const body = await res.json();

                    if (body && body.ok && body.instance) {
                        // Normalizar instancia
                        const instPayload = body.instance;
                        // Si la API devuelve { name, data } empaquetarlo a objeto de instancia
                        const instanceObj = instPayload.data ? Object.assign({}, instPayload.data, { name: instPayload.name }) : Object.assign({}, instPayload, { name: instPayload.name || instPayload?.data?.name });

                        // Guardar en DB (addedInstances)
                        const saved = await this.db.createData('addedInstances', instanceObj);
                        // saved incluirá .ID por la implementación de database.createData
                        window.notify({ message: `Instancia "${instanceObj.name}" añadida.`, type: "success" });
                        closeAddInstancePopup();

                        // refrescar UI (reconstruir selector)
                        setTimeout(() => {
                            try { this.instancesSelect(); } catch (e) { console.warn(e) }
                        }, 200);
                    } else {
                        const msg = (body && body.message) ? body.message : 'Código inválido';
                        window.notify({ message: msg, type: "error" });
                    }
                } catch (err) {
                    console.error(err);
                    window.notify({ message: "Error al comprobar el código.", type: "error" });
                }
            });
        }

        // --- Aplica modo streamer si está activo ---
        let configClient = await this.db.readData('configClient');
        window.applyStreamerMode(configClient?.launcher_config?.streamer_mode);

        // Oculta datos sensibles si modo streamer activo (más completo)
        if (configClient?.launcher_config?.streamer_mode) {
            // Oculta nombre de usuario, UUID, y otros datos sensibles
            document.querySelectorAll('.player-head, .profile-pseudo, .profile-uuid, .session-info-value, .account-select, .instance-name, .add-text-profile').forEach(el => {
                if (el) el.textContent = 'Streamer';
            });
            // Oculta posibles imágenes de perfil
            document.querySelectorAll('.profile-image, .player-head').forEach(el => {
                if (el) el.style.background = '#a78bfa';
            });
            // Oculta el número de jugadores y cualquier número sensible
            document.querySelectorAll('.player-count, .server-status-name, .server-status-text').forEach(el => {
                if (el) el.textContent = 'Streamer';
            });
            // Oculta notificaciones privadas
            document.querySelectorAll('.notification-message').forEach(el => {
                if (el) el.textContent = 'Modo Streaming Activado';
            });
            // Cambia el fondo de home y paneles a morado
            document.body.classList.add('streamer-mode');
            let homePanel = document.querySelector('.home');
            if (homePanel) {
                homePanel.style.background = '#7c3aed';
            }
            document.querySelectorAll('.panel').forEach(panel => {
                panel.style.background = '#7c3aed';
                panel.style.color = '#fff';
            });
        } else {
            // Restaura estilos si se desactiva el modo streamer
            document.body.classList.remove('streamer-mode');
            let homePanel = document.querySelector('.home');
            if (homePanel) {
                homePanel.style.background = '';
            }
            document.querySelectorAll('.panel').forEach(panel => {
                panel.style.background = '';
                panel.style.color = '';
            });
        }
    }

    async initMusicPlayer() {
        let configClient = await this.db.readData('configClient');
        this.musicEnabled = configClient?.music_enabled !== false; // true por defecto
        // Actualiza el icono según el estado
        const musicBtn = document.querySelector('.music-btn');
        // Protección si el botón no existe en el DOM
        if (musicBtn) {
            if (this.musicEnabled) {
                musicBtn.classList.add('icon-speaker-on');
                musicBtn.classList.remove('icon-speaker-off');
            } else {
                musicBtn.classList.remove('icon-speaker-on');
                musicBtn.classList.add('icon-speaker-off');
            }
        }

        // Evento click para pausar/reanudar música
        if (musicBtn) {
            musicBtn.onclick = async () => {
                this.musicEnabled = !this.musicEnabled;
                let configClient = await this.db.readData('configClient');
                configClient.music_enabled = this.musicEnabled;
                await this.db.updateData('configClient', configClient);

                if (this.musicEnabled) {
                    musicBtn.classList.add('icon-speaker-on');
                    musicBtn.classList.remove('icon-speaker-off');
                    window.notify({ message: "Música activada", type: "success" });
                    this.playMusicForCurrentInstance();
                } else {
                    musicBtn.classList.remove('icon-speaker-on');
                    musicBtn.classList.add('icon-speaker-off');
                    window.notify({ message: "Música desactivada", type: "info" });
                    this.musicPlayer.pause();
                }
            };
        }
    }

    async playMusicForCurrentInstance() {
        let configClient = await this.db.readData('configClient');
        let instancesList = await config.getInstanceList();
        let instance = instancesList.find(i => i.name === configClient.instance_selct);
        let musicUrl = instance?.music || null;

        if (this.musicEnabled && musicUrl) {
            if (this.currentMusicUrl !== musicUrl) {
                this.musicPlayer.src = musicUrl;
                this.currentMusicUrl = musicUrl;
            }
            try {
                await this.musicPlayer.play();
            } catch (e) {
                // Silenciar error de autoplay bloqueado
            }
        } else {
            this.musicPlayer.pause();
            this.musicPlayer.src = '';
            this.currentMusicUrl = null;
        }
    }

    async IniciarEstadoDiscord() {
        try {
            let configClient = await this.db.readData('configClient');
            const enabled = configClient?.launcher_config?.discord_rpc?.enabled !== false;
            if (enabled) {
                const activity = {
                    details: 'En Men� Principal',
                    state: 'Lad Client',
                    assets: { large_image: 'launcher' },
                    instance: false,
                    timestamps: { start: Date.now() }
                };
                ipcRenderer.send('discord-set-activity', activity);
            } else {
                ipcRenderer.send('discord-clear-activity');
            }
        } catch (_) {
            ipcRenderer.send('new-status-discord');
        }
        // Protecciones si los elementos no están presentes
        const preload = document.querySelector(".preload-content");
        if (preload) preload.style.display = "none";
        const settingsBtn = document.querySelector('.action-button-settings');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', e => {
                window.notify({ message: "Guardando configuración...", type: "success" });
                changePanel('settings');
            });
        }
    }

    async news() {
        let newsElement = document.querySelector('.news-list');
        if (!newsElement) return; // protección contra null (evita el error en consola)
        // evitar duplicados: limpiar el contenedor antes de repoblar
        newsElement.innerHTML = '';

        let news = await config.getNews().then(res => res).catch(err => false);
        if (news) {
            if (!news.length) {
                let blockNews = document.createElement('div');
                blockNews.classList.add('news-block');
                blockNews.innerHTML = `
                    <div class="news-header">
                        <img class="server-status-icon" src="assets/images/icon.png">
                        <div class="header-text">
                            <div class="title">Aucun news n'ai actuellement disponible.</div>
                        </div>
                        <div class="date">
                            <div class="day">1</div>
                            <div class="month">Janvier</div>
                        </div>
                    </div>
                    <div class="news-content">
                        <div class="bbWrapper">
                            <p>Vous pourrez suivre ici toutes les news relative au serveur.</p>
                        </div>
                    </div>`
                newsElement.appendChild(blockNews);
            } else {
                for (let News of news) {
                    // Media (imagen/video/gif/youtube)
                    let mediaContent = '';
                    if (News.image) {
                        if (News.image.includes('youtube.com') || News.image.includes('youtu.be')) {
                            let videoId = '';
                            if (News.image.includes('youtube.com/watch?v=')) {
                                videoId = News.image.split('v=')[1].split('&')[0];
                            } else if (News.image.includes('youtu.be/')) {
                                videoId = News.image.split('youtu.be/')[1];
                            }
                            mediaContent = `
                                <div class="news-block-media">
                                    <iframe src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe>
                                </div>`;
                        } else if (/\.(mp4|webm|ogg)$/i.test(News.image)) {
                            mediaContent = `<div class="news-block-media">
                                <video src="${News.image}" autoplay loop muted playsinline></video>
                            </div>`;
                        } else {
                            mediaContent = `<div class="news-block-media">
                                <img src="${News.image}" alt="News media" />
                            </div>`;
                        }
                    } else {
                        mediaContent = `<div class="news-block-media" style="background:#222"></div>`;
                    }

                    // Botón solo si hay link
                    let buttonContent = '';
                    if (News.buttons && News.buttons.length > 0 && News.buttons[0].url) {
                        buttonContent = `<a href="#" class="news-button" data-url="${News.buttons[0].url}">
                            ${News.buttons[0].text || 'Leer más'}
                            <svg class="news-btn-icon" viewBox="0 0 16 16"><path d="M10.5 2a.5.5 0 0 0 0 1h2.793L6.146 10.146a.5.5 0 1 0 .708.708L14 3.707V6.5a.5.5 0 0 0 1 0v-4z"/><path d="M13.5 14a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11A.5.5 0 0 1 2 2.5H6a.5.5 0 0 1 0 1H2.5v11h11V10a.5.5 0 0 1 1 0v4z"/></svg>
                        </a>`;
                    }

                    // Fecha formateada (usa publish_date tal cual)
                    let fecha = News.publish_date || '';

                    // Bloque info
                    let infoContent = `
                        <div class="news-block-info">
                            <div class="news-block-title-row">
                                <span class="news-block-title">${News.title}</span>
                            </div>
                            <div class="news-block-date-row">
                                <span class="news-block-date-label">News</span>
                                <span class="news-block-date">${fecha}</span>
                            </div>
                            <div class="news-block-content">${News.content}</div>
                            <div class="news-block-btn-row">
                                ${buttonContent}
                            </div>
                        </div>
                    `;

                    // Render final
                    let blockNews = document.createElement('div');
                    blockNews.classList.add('news-block');
                    blockNews.innerHTML = mediaContent + infoContent;
                    newsElement.appendChild(blockNews);
                }

                // usar delegación: añadir un listener único al contenedor para manejar clicks en botones
                if (!newsElement.dataset.listenerAttached) {
                    newsElement.addEventListener('click', (e) => {
                        const btn = e.target.closest('.news-button');
                        if (!btn) return;
                        e.preventDefault();
                        const url = btn.dataset.url;
                        if (url) shell.openExternal(url);
                    });
                    newsElement.dataset.listenerAttached = '1';
                }
            }
        } else {
            let blockNews = document.createElement('div');
            blockNews.classList.add('news-block');
            blockNews.innerHTML = `
                <div class="news-header">
                        <img class="server-status-icon" src="assets/images/icon.png">
                        <div class="header-text">
                            <div class="title">Error.</div>
                        </div>
                        <div class="date">
                            <div class="day">1</div>
                            <div class="month">Janvier</div>
                        </div>
                    </div>
                    <div class="news-content">
                        <div class="bbWrapper">
                            <p>Impossible de contacter le serveur des news.</br>Merci de vérifier votre configuration.</p>
                        </div>
                    </div>`
            newsElement.appendChild(blockNews);
        }
    }

    socialLick() {
        // Delegación única: añadir listener al contenedor .social-list para evitar múltiples handlers
        try {
            const socialList = document.querySelector('.social-list');
            if (!socialList) return;
            if (!socialList.dataset.handlersAttached) {
                socialList.addEventListener('click', (e) => {
                    const target = e.target.closest('.social-block');
                    if (!target) return;
                    const url = target.dataset.url;
                    if (!url) return;
                    window.notify({ message: "Abriendo enlace externo...", type: "info", timeout: 1200 });
                    shell.openExternal(url);
                });
                socialList.addEventListener('keydown', (e) => {
                    const target = e.target.closest('.social-block');
                    if (!target) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        const url = target.dataset.url;
                        if (url) {
                            window.notify({ message: "Abriendo enlace externo...", type: "info", timeout: 1200 });
                            shell.openExternal(url);
                        }
                    }
                });
                socialList.dataset.handlersAttached = '1';
            }
            // asegurar atributos de accesibilidad en los elementos existentes
            document.querySelectorAll('.social-block').forEach(s => {
                if (!s.hasAttribute('role')) s.setAttribute('role', 'link');
                if (!s.hasAttribute('tabindex')) s.setAttribute('tabindex', '0');
            });
        } catch (e) { console.warn('socialLick delegation failed', e); }
    }


    async instancesSelect() {
        // Lectura segura de datos: si falta configClient, accounts o instancias, manejar el caso.
        let configClient = await this.db.readData('configClient') || {};
        let auth = null;
        if (configClient.account_selected) {
            auth = await this.db.readData('accounts', configClient.account_selected).catch(() => null);
        }
        let instancesList = await config.getInstanceList() || [];

        // Filtrar instancias "internas" (instances.php) si existen flags que las identifiquen
        const filtered = instancesList.filter(i => !i.internal && !i.fromFile && !i.private);
        if (filtered.length > 0) instancesList = filtered;

        // Cargar instancias añadidas localmente desde la DB y marcarlas como locales
        let localAdded = await this.db.readAllData('addedInstances').catch(() => []);
        if (!Array.isArray(localAdded)) localAdded = [];
        const mappedLocal = localAdded.map(li => {
            const inst = Object.assign({}, li);
            inst._local = true;
            inst._localId = li.ID;
            return inst;
        });

        // Fusionar: remotas primero, luego añadidas localmente
        instancesList = instancesList.concat(mappedLocal);

        if (!Array.isArray(instancesList) || instancesList.length === 0) {
            window.notify({ message: "No hay instancias disponibles.", type: "error", timeout: 2200 });
            return;
        }

        // Determinar instancia seleccionada actual o elegir una por defecto
        let instanceSelect = null;
        if (configClient.instance_selct) {
            const found = instancesList.find(i => i && i.name === configClient.instance_selct);
            instanceSelect = found ? configClient.instance_selct : null;
        }
        if (!instanceSelect) {
            let newInstanceSelect = instancesList.find(i => !i?.whitelistActive) || instancesList[0];
            let cfg = await this.db.readData('configClient') || {};
            cfg.instance_selct = newInstanceSelect.name;
            instanceSelect = newInstanceSelect.name;
            await this.db.updateData('configClient', cfg);
            window.notify({ message: "Instancia seleccionada automáticamente.", type: "info", timeout: 1500 });
        }

        // Set background + music para instancia seleccionada
        const homePanel = document.querySelector('.home');
        if (instanceSelect) {
            const selectedInstance = instancesList.find(i => i && i.name === instanceSelect);
            if (selectedInstance && selectedInstance.background) {
                window.setHomeBackgroundMedia(selectedInstance.background);
                if (homePanel) {
                    homePanel.style.backgroundSize = 'cover';
                    homePanel.style.backgroundPosition = 'center';
                }
            } else {
                window.setHomeBackgroundMedia(null);
                if (homePanel) homePanel.style.backgroundImage = '';
            }
            await this.playMusicForCurrentInstance();
        }

        // actualizar status si corresponde
        for (let instance of instancesList) {
            if (instance?.whitelistActive) {
                const whitelistArray = Array.isArray(instance.whitelist) ? instance.whitelist : [];
                let whitelistMatch = whitelistArray.find(w => w == auth?.name);
                if (!whitelistMatch) {
                    if (instance.name === instanceSelect) {
                        let newInstanceSelect = instancesList.find(i => !i?.whitelistActive) || instancesList[0];
                        let cfg = await this.db.readData('configClient') || {};
                        cfg.instance_selct = newInstanceSelect.name;
                        instanceSelect = newInstanceSelect.name;
                        if (newInstanceSelect?.status) setStatus(newInstanceSelect.status);
                        await this.db.updateData('configClient', cfg)
                    }
                }
            } else {
                if (instance?.name) console.log(`Iniciando instancia ${instance.name}...`)
            }
            if (instance?.name === instanceSelect) {
                if (instance?.status) setStatus(instance.status)
            }
        }

        // Renderizar grid en la sidebar2
        const instancesGrid = document.querySelector('.instances-grid');
        if (!instancesGrid) return;
        instancesGrid.innerHTML = ''; // limpiar
        // evitar reañadir listeners múltiples veces
        if (!instancesGrid.dataset.handlersAttached) {
            // Delegated events: click, hover preview, delete local (only attach once)
            let previewEl = null;
            instancesGrid.addEventListener('click', async (e) => {
                // Si se está lanzando una instancia, bloquear cambios de selección y eliminar
                if (this.launching) {
                    window.notify({ message: "No se puede cambiar de instancia mientras se inicia una instancia.", type: "warn", timeout: 2200 });
                    try { window.customConsoleLog && window.customConsoleLog('info', 'Intento de cambio de instancia bloqueado durante lanzamiento'); } catch(_) {}
                    return;
                }

                const del = e.target.closest('.local-instance-delete');
                if (del) {
                    const localId = parseInt(del.dataset.localId, 10);
                    if (!isNaN(localId)) {
                        await this.db.deleteData('addedInstances', localId).catch(() => null);
                        window.notify({ message: "Instancia eliminada.", type: "info" });
                        try { window.customConsoleLog && window.customConsoleLog('info', `Instancia local eliminada (ID ${localId})`); } catch(_) {}
                        setTimeout(() => { this.instancesSelect(); }, 200);
                    }
                    return;
                }

                const item = e.target.closest('.sidebar-instance');
                if (!item) {
                    // Si se clicó en otra parte dentro play-instance, iniciar juego
                    const playInstanceBTN = e.target.closest('.play-instance');
                    if (playInstanceBTN && !e.target.closest('.instance-select')) {
                        window.notify({ message: "Iniciando juego...", type: "info" });
                        try { window.customConsoleLog && window.customConsoleLog('info', 'Botón JUGAR pulsado'); } catch(_) {}
                        this.startGame()
                    }
                    return;
                }

                // --- NUEVO: evitar seleccionar instancia offline ---
                if (item.querySelector('.sidebar-instance-cover.sidebar-instance-offline')) {
                    const instName = item.getAttribute('data-instance-name') || 'Instancia';
                    window.notify({ message: "La instancia está offline.", type: "error" });
                    try { window.customConsoleLog && window.customConsoleLog('warn', `Instancia "${instName}" offline`); } catch(_) {}
                    return;
                }

                // Seleccionar instancia
                const newInstanceSelect = item.getAttribute('data-instance-name');
                let cfg = await this.db.readData('configClient') || {};
                cfg.instance_selct = newInstanceSelect;
                await this.db.updateData('configClient', cfg);

                // actualizar UI: marcar activo
                document.querySelectorAll('.sidebar-instance').forEach(i => i.classList.remove('active-sidebar-instance'));
                item.classList.add('active-sidebar-instance');

                // Cambiar fondo y música
                const options = instancesList.find(i => i.name == newInstanceSelect);
                if (options && options.background) {
                    window.setHomeBackgroundMedia(options.background);
                    if (homePanel) {
                        homePanel.style.backgroundSize = 'cover';
                        homePanel.style.backgroundPosition = 'center';
                    }
                } else {
                    window.setHomeBackgroundMedia(null);
                    if (homePanel) homePanel.style.backgroundImage = '';
                }
                await this.playMusicForCurrentInstance();
                if (options?.status) setStatus(options.status);
                window.notify({ message: `Instancia "${newInstanceSelect}" seleccionada.`, type: "success" });
                try { window.customConsoleLog && window.customConsoleLog('info', `Instancia seleccionada: ${newInstanceSelect}`); } catch(_) {}
            });
            // pointerover / pointerout handlers
            instancesGrid.addEventListener('pointerover', (e) => {
                const item = e.target.closest('.sidebar-instance');
                if (!item) return;
                // Si ya existe, quitar para recrear actualizado
                if (previewEl) { previewEl.remove(); previewEl = null; }
                const instName = item.getAttribute('data-instance-name') || item.querySelector('.sidebar-instance-name')?.textContent || 'Instancia';
                previewEl = document.createElement('div');
                previewEl.className = 'instance-preview';
                previewEl.textContent = instName;
                document.body.appendChild(previewEl);
                const rect = item.getBoundingClientRect();
                const computedWidth = Math.min(320, Math.max(120, previewEl.offsetWidth || 140));
                const computedHeight = previewEl.offsetHeight || 40;
                let left = rect.right + 12;
                if (left + computedWidth > window.innerWidth - 12) {
                    left = rect.left - computedWidth - 12;
                }
                if (left < 12) left = 12;
                let top = rect.top + Math.max(0, (rect.height / 2) - (computedHeight / 2));
                if (top + computedHeight > window.innerHeight - 12) {
                    top = Math.max(12, window.innerHeight - computedHeight - 12);
                }
                if (top < 12) top = 12;
                previewEl.style.left = `${left}px`;
                previewEl.style.top = `${top}px`;
                previewEl.style.width = `${computedWidth}px`;
                // Mostrar con animación
                requestAnimationFrame(() => previewEl.classList.add('show'));
            }, { passive: true });
            instancesGrid.addEventListener('pointerout', (e) => {
                if (!previewEl) return;
                const related = e.relatedTarget;
                // Si el puntero se movió dentro del preview, no cerramos
                if (related && previewEl.contains(related)) return;
                previewEl.classList.remove('show');
                // pequeña espera para permitir anim-out si hay transición, luego eliminar
                setTimeout(() => { if (previewEl) { previewEl.remove(); previewEl = null; } }, 160);
             });
            instancesGrid.dataset.handlersAttached = '1';
        }

        for (let instance of instancesList) {
            // comprobar visibilidad por whitelist
            let canShow = true;
            if (instance?.whitelistActive) {
                const whitelistArray = Array.isArray(instance.whitelist) ? instance.whitelist : [];
                canShow = !!whitelistArray.find(w => w == auth?.name);
            }
            if (!canShow || !instance?.name) continue;

            const cover = instance.cover ? instance.cover : 'assets/images/default/default_cover.jpg';

            // --- NUEVO: detectar estado online/offline ---
            const isOnline = !!(instance?.status && instance.status.online === true);
            const onlineClass = isOnline ? ' sidebar-instance-online' : ' sidebar-instance-offline';
            const disabledAttr = isOnline ? '' : ' aria-disabled="true"';

            const isActive = instance.name === instanceSelect ? ' active-sidebar-instance' : '';
            const localDeleteBtn = instance._local ? `<button class="local-instance-delete" data-local-id="${instance._localId}" title="Eliminar instancia">×</button>` : '';

            const el = document.createElement('div');
            el.className = `sidebar-instance${isActive}`;
            el.setAttribute('data-instance-name', instance.name);
            el.setAttribute('role','listitem');
            el.innerHTML = `
                <div class="sidebar-instance-cover${onlineClass}" style="background-image: url('${cover}')" aria-hidden="true"${disabledAttr}></div>
                <div class="sidebar-instance-name">${instance.name}</div>
                ${localDeleteBtn}
            `;
            instancesGrid.appendChild(el);
        }

        // Nota: el click handler real de selección de instancia está gestionado dentro del listener
        // agregado arriba cuando se creó handlersAttached (evita duplicados).
    }

    // --- NUEVO: carga template del menú desde panels/instance-menu.html e inicializa handlers ---
    async loadInstanceMenuTemplate() {
        try {
            const res = await fetch('panels/instance-menu.html');
            if (!res.ok) return;
            const html = await res.text();
            document.body.insertAdjacentHTML('beforeend', html);

            // Elementos
            this.instanceMenuOverlay = document.querySelector('.instance-menu-overlay');
            this.instanceMenuList = document.querySelector('.instance-menu-list');
            this.instanceMenuClose = document.querySelector('.instance-menu-close');
            this.instanceMenuBackdrop = document.querySelector('.instance-menu-backdrop');
            this.instanceMenuPreview = document.querySelector('.instance-menu-preview');
            this.instanceMenuBox = this.instanceMenuOverlay?.querySelector('.instance-menu');

            // Handlers: close button & backdrop
            this.instanceMenuClose?.addEventListener('click', (e) => { e.stopPropagation(); this.closeInstanceMenu(); });
            this.instanceMenuBackdrop?.addEventListener('click', (e) => { e.stopPropagation(); this.closeInstanceMenu(); });

            // Prevent clicks inside menu from bubbling to overlay/backdrop
            if (this.instanceMenuBox) {
                this.instanceMenuBox.addEventListener('click', (e) => e.stopPropagation());
            }

            // Global handlers to close robustly: click outside + Escape
            this._boundDocClick = (e) => {
                try {
                    if (!this.instanceMenuOverlay || !this.instanceMenuOverlay.classList.contains('open')) return;
                    if (!this.instanceMenuBox) return;
                    if (!this.instanceMenuBox.contains(e.target)) this.closeInstanceMenu();
                } catch (err) {}
            };
            this._boundEscKey = (e) => {
                if (e.key === 'Escape') this.closeInstanceMenu();
            };

            // Add when template loaded, but listeners only active while open.
            // We attach now so removal is consistent later.
            document.addEventListener('click', this._boundDocClick);
            document.addEventListener('keydown', this._boundEscKey);

            // Conectar botón .instance-select para abrir el menú
            const instanceSelectBtn = document.querySelector('.instance-select');
            if (instanceSelectBtn) {
                instanceSelectBtn.addEventListener('click', (e) => {
                    // evita propagación con otros handlers
                    e.stopPropagation();
                    this.openInstanceMenu();
                });
            }
        } catch (e) {
            console.warn('No se pudo cargar instance-menu template:', e);
        }
    }

    // Abre el overlay y lo puebla
    async openInstanceMenu() {
        if (!this.instanceMenuOverlay) return;
        // populate con instancias actuales (remotas + locales)
        let instancesList = await config.getInstanceList() || [];
        let localAdded = await this.db.readAllData('addedInstances').catch(() => []);
        if (!Array.isArray(localAdded)) localAdded = [];
        instancesList = instancesList.concat(localAdded.map(li => Object.assign({}, li, { _local: true, _localId: li.ID })));

        // obtener account_selected para comprobar whitelist
        const cfg = await this.db.readData('configClient').catch(()=>({}));
        const auth = cfg.account_selected ? await this.db.readData('accounts', cfg.account_selected).catch(()=>null) : null;

        // helper: comprobar si auth está en la whitelist de la instancia
        const isInWhitelist = (inst, authObj) => {
            if (!inst || !inst.whitelistActive) return false;
            const wl = Array.isArray(inst.whitelist) ? inst.whitelist : [];
            if (!wl.length) return false;
            if (!authObj) return false;
            return wl.some(w => w == authObj.name || w == authObj.username || w == authObj.displayName || w == authObj.email);
        };

        // filtrar: mostrar solo públicas, locales, o privadas donde auth esté permitido
        const visibleInstances = instancesList.filter(inst => {
            if (!inst) return false;
            if (inst._local) return true; // siempre mostrar instancias añadidas localmente
            if (!inst.whitelistActive) return true; // públicas
            return isInWhitelist(inst, auth); // privadas sólo si auth está en la whitelist
        });

        this.populateInstanceMenu(visibleInstances, auth);

         // mostrar overlay (full-screen) y lanzar animación
         this.instanceMenuOverlay.style.display = 'flex';
         this.instanceMenuOverlay.setAttribute('aria-hidden', 'false');

         // limpiamos clases por si acaso
         this.instanceMenuOverlay.classList.remove('anim-out');
         // fuerza reflow para reiniciar animación
         void this.instanceMenuOverlay.offsetWidth;
         this.instanceMenuOverlay.classList.add('anim-in', 'open');

         // remover clase de entrada al terminar la animación para mantener estado limpio
         const onAnimEnd = (e) => {
             if (e.target === this.instanceMenuOverlay) {
                 this.instanceMenuOverlay.classList.remove('anim-in');
                 this.instanceMenuOverlay.removeEventListener('animationend', onAnimEnd);
             }
         };
         this.instanceMenuOverlay.addEventListener('animationend', onAnimEnd);
    }

    // Cierra el overlay (usa animación out y oculta al terminar)
    closeInstanceMenu() {
        if (!this.instanceMenuOverlay) return;
        // Si ya está cerrando, ignorar
        if (this.instanceMenuOverlay.classList.contains('anim-out')) return;

        // iniciar animación de salida
        this.instanceMenuOverlay.classList.remove('anim-in', 'open');
        this.instanceMenuOverlay.classList.add('anim-out');

        const onAnimComplete = (e) => {
            if (e.target === this.instanceMenuOverlay) {
                // ocultar y limpiar
                this.instanceMenuOverlay.style.display = 'none';
                this.instanceMenuOverlay.classList.remove('anim-out', 'open', 'anim-in');
                this.instanceMenuOverlay.setAttribute('aria-hidden', 'true');
                // limpiar preview
                if (this.instanceMenuPreview) {
                    this.instanceMenuPreview.style.display = 'none';
                    this.instanceMenuPreview.innerHTML = '';
                }
                this.instanceMenuOverlay.removeEventListener('animationend', onAnimComplete);
            }
        };
        this.instanceMenuOverlay.addEventListener('animationend', onAnimComplete);
    }

    // Poblado simple: lista vertical con cover y nombre, datos en data-*
    populateInstanceMenu(instances, auth) {
        if (!this.instanceMenuList) return;
        this.instanceMenuList.innerHTML = '';

        const isInWhitelist = (inst, authObj) => {
            if (!inst || !inst.whitelistActive) return false;
            const wl = Array.isArray(inst.whitelist) ? inst.whitelist : [];
            if (!wl.length) return false;
            if (!authObj) return false;
            return wl.some(w => w == authObj.name || w == authObj.username || w == authObj.displayName || w == authObj.email);
        };

        instances.forEach(inst => {
            // crear item
            const item = document.createElement('div');
            item.className = 'instance-menu-item';
            const cover = inst.cover ? inst.cover : 'assets/images/default/default_cover.jpg';
            // atributos para preview
            item.dataset.name = inst.name || 'N/D';
            item.dataset.version = (inst.loadder && inst.loadder.minecraft_version) || inst.version || inst.minecraft_version || 'N/D';
            item.dataset.loader = (inst.loadder && inst.loadder.loadder_type) || 'none';
            item.dataset.online = inst.status && inst.status.online ? 'online' : 'offline';

            // marcar tipo de visibilidad para CSS defensivo
            if (inst._local) {
                item.dataset.whitelist = 'local';
            } else if (inst.whitelistActive) {
                item.dataset.whitelist = isInWhitelist(inst, auth) ? 'allowed' : 'private';
            } else {
                item.dataset.whitelist = 'public';
            }

            item.innerHTML = `
                <div class="item-cover" style="background-image:url('${cover}')"></div>
                <div class="item-meta">
                    <div class="item-name">${inst.name}</div>
                    <div class="item-sub">${item.dataset.version} · ${item.dataset.loader}</div>
                </div>
            `;
            // hover preview handlers
            item.addEventListener('mouseenter', (e) => this.showInstancePreview(e.currentTarget));
            item.addEventListener('mouseleave', () => this.hideInstancePreview());
            // click simplemente muestra toast (solo visual) y no cambia selección
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                window.notify({ message: `${inst.name} — ${item.dataset.online}`, type: item.dataset.online === 'online' ? 'success' : 'error', timeout: 1200 });
            });

            this.instanceMenuList.appendChild(item);
        });
    }

    showInstancePreview(target) {
        if (!this.instanceMenuPreview || !target) return;
        const name = target.dataset.name || '';
        const version = target.dataset.version || '';
        const loader = target.dataset.loader || '';
        const online = target.dataset.online === 'online';

        const coverUrl = target.querySelector('.item-cover')?.style.backgroundImage?.match(/url\(["']?(.*?)["']?\)/)?.[1] || '';

        this.instanceMenuPreview.classList.remove('position-above');
        this.instanceMenuPreview.innerHTML = `
            <div class="preview-row minimal">
                <div class="preview-thumb" style="background-image: url('${coverUrl || 'assets/images/default/default_cover.jpg'}')"></div>
                <div class="preview-info">
                    <div class="preview-name">${name}</div>
                    <div class="preview-meta small"><span class="meta-label">Versión</span> ${version}</div>
                    <div class="preview-meta small"><span class="meta-label">Loader</span> ${loader}</div>
                </div>
            </div>
            <div class="preview-footer minimal">
                <span class="preview-status-badge ${online ? 'online' : 'offline'}">${online ? 'Online' : 'Offline'}</span>
            </div>
        `;
        this.instanceMenuPreview.style.display = 'block';
        this.instanceMenuPreview.setAttribute('aria-hidden', 'false');

        // Positioning: prefer bottom-left of the menu box; if no menu box, fallback to overlay
        const menuRect = this.instanceMenuBox ? this.instanceMenuBox.getBoundingClientRect() : (this.instanceMenuOverlay ? this.instanceMenuOverlay.getBoundingClientRect() : null);
        if (!menuRect) {
            // fallback to previous behavior: place near target
            const rect = target.getBoundingClientRect();
            const previewWidth = Math.min(320, window.innerWidth * 0.28);
            const previewHeight = 130;
            let left = rect.right + 12;
            // si se sale por la derecha, poner a la izquierda
            if (left + previewWidth > window.innerWidth - 12) {
                left = rect.left - previewWidth - 12;
            }
            if (left < 12) left = 12;
            let top = Math.max(12, rect.top - 8);
            if (top + previewHeight > window.innerHeight - 12) {
                top = Math.max(12, window.innerHeight - previewHeight - 12);
            }
            previewEl.style.top = `${top}px`;
            previewEl.style.left = `${left}px`;
            previewEl.style.width = `${previewWidth}px`;
            previewEl.style.height = `${previewHeight}px`;
        }

        const previewWidth = Math.min(280, Math.max(180, Math.floor(window.innerWidth * 0.22)));
        const previewHeight = 120;

        // prefer bottom-left of menu
        let left = menuRect.left + 12;
        let top = menuRect.bottom + 10; // below menu

        // if overflowing right, nudge left
        if (left + previewWidth > window.innerWidth - 12) {
            left = Math.max(12, window.innerWidth - previewWidth - 12);
        }

        // if bottom overflows, place ABOVE the menu and add class
        if (top + previewHeight > window.innerHeight - 12) {
            top = menuRect.top - previewHeight - 10;
            this.instanceMenuPreview.classList.add('position-above');
        } else {
            this.instanceMenuPreview.classList.remove('position-above');
        }

        // ensure not off-screen left/top
        if (left < 8) left = 8;
        if (top < 8) top = 8;

        // apply styles
        this.instanceMenuPreview.style.left = `${left}px`;
        this.instanceMenuPreview.style.top = `${top}px`;
        this.instanceMenuPreview.style.width = `${previewWidth}px`;

        // subtle show animation
        this.instanceMenuPreview.style.opacity = '0';
        this.instanceMenuPreview.style.transform = 'translateY(6px)';
        requestAnimationFrame(() => {
            this.instanceMenuPreview.style.transition = 'opacity 200ms ease, transform 200ms ease';
            this.instanceMenuPreview.style.opacity = '1';
            this.instanceMenuPreview.style.transform = 'translateY(0)';
        });
    }

    hideInstancePreview() {
        if (!this.instanceMenuPreview) return;
        this.instanceMenuPreview.style.display = 'none';
        this.instanceMenuPreview.setAttribute('aria-hidden', 'true');
        this.instanceMenuPreview.innerHTML = '';
    }

    // Cierra el overlay (usa hide simple) -> también quita listeners temporales si es necesario
    closeInstanceMenu() {
        if (!this.instanceMenuOverlay) return;
        // Limpiar estado y ocultar inmediatamente
        this.instanceMenuOverlay.classList.remove('open', 'anim-in', 'anim-out');
        this.instanceMenuOverlay.style.display = 'none';
        this.instanceMenuOverlay.setAttribute('aria-hidden', 'true');

        // ocultar preview
        if (this.instanceMenuPreview) {
            this.instanceMenuPreview.style.display = 'none';
            this.instanceMenuPreview.setAttribute('aria-hidden', 'true');
            this.instanceMenuPreview.innerHTML = '';
        }

        // Note: keep global document listeners attached (they ignore when overlay closed), but if you prefer to remove add:
        // document.removeEventListener('click', this._boundDocClick);
        // document.removeEventListener('keydown', this._boundEscKey);
    }

    // Atacha handlers del botón "JUGAR" de forma idempotente
    _attachPlayHandlers() {
        if (this._playHandlersAttached) return;
        const playContainer = document.querySelector('.play-instance');
        if (!playContainer) return;

        // Click sobre el contenedor .play-instance (ignorar clicks en .instance-select)
        playContainer.addEventListener('click', async (e) => {
            // Si el click fue sobre el control de selección de instancia, no iniciar
            if (e.target && e.target.closest && e.target.closest('.instance-select')) return;
            try {
                // Protección por si startGame no existe o ya está running
                if (typeof this.startGame === 'function') await this.startGame();
            } catch (err) {
                console.error('Error invoking startGame from play button:', err);
            }
        });

        // Permitir activación por teclado en el botón interior .play-btn
        const playBtn = playContainer.querySelector('.play-btn');
        if (playBtn) {
            playBtn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    playContainer.click();
                }
            });
        }

        this._playHandlersAttached = true;
    }

    async startGame() {
        try {
            // Evitar doble inicio
            if (this.launching) {
                window.notify({ message: "Ya se está iniciando una instancia.", type: "info" });
                return;
            }

            this.launching = true;

            const launch = new Launch();
            // Leer y normalizar configClient con valores por defecto
            let configClient = await this.db.readData('configClient') || {};
            configClient.launcher_config = configClient.launcher_config || {};
            configClient.java_config = configClient.java_config || { java_path: null, java_memory: { min: 2, max: 4 } };
            configClient.java_config.java_memory = configClient.java_config.java_memory || { min: 2, max: 4 };
            configClient.game_config = configClient.game_config || { screen_size: { width: 854, height: 480 } };

            const instances = await config.getInstanceList() || [];
            const authenticator = configClient.account_selected ? await this.db.readData('accounts', configClient.account_selected).catch(() => null) : null;
            const options = instances.find(i => i && i.name == configClient.instance_selct);

            if (!options) {
                window.notify({ message: "No se ha seleccionado una instancia válida.", type: "error" });
                return;
            }

            // Normalizar propiedades de options para evitar undefined
            options.loadder = options.loadder || {};
            options.loadder.loadder_type = options.loadder.loadder_type || 'none';
            options.loadder.loadder_version = options.loadder.loadder_version || '';
            options.loadder.minecraft_version = options.loadder.minecraft_version || options.version || '1.16.5';
            options.verify = typeof options.verify !== 'undefined' ? options.verify : false;
            options.ignored = Array.isArray(options.ignored) ? options.ignored : [];

            // Valores seguros
            const javaMem = configClient.java_config.java_memory || { min: 2, max: 4 };
            const screen = configClient.game_config.screen_size || { width: 854, height: 480 };

            const opt = {
                url: options.url,
                authenticator: authenticator,
                timeout: 10000,
                path: `${await appdata()}/${process.platform == 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}`,
                instance: options.name,
                version: options.loadder.minecraft_version,
                detached: configClient.launcher_config.closeLauncher == "close-all" ? false : true,
                downloadFileMultiple: configClient.launcher_config.download_multi || 5,
                intelEnabledMac: !!configClient.launcher_config.intelEnabledMac,

                loader: {
                    type: options.loadder.loadder_type,
                    build: options.loadder.loadder_version,
                    enable: options.loadder.loadder_type == 'none' ? false : true
                },

                verify: options.verify,
                ignored: [...options.ignored],

                javaPath: configClient.java_config.java_path || null,

                screen: {
                    width: screen.width,
                    height: screen.height
                },

                memory: {
                    min: `${(javaMem.min || 2) * 1024}M`,
                    max: `${(javaMem.max || 4) * 1024}M`
                }
            };

            launch.Launch(opt);

            // Iniciar contador: suma 1 minuto cada 60s mientras la instancia esté en ejecución
            if (!this.playTimerId) {
                // No incrementar inmediatamente; contar cada 1 minuto a partir del inicio
                this.playTimerId = setInterval(() => {
                    try {
                        this.playedMinutes = (parseInt(localStorage.getItem('playedMinutes') || '0', 10) || 0) + 1;
                        localStorage.setItem('playedMinutes', this.playedMinutes.toString());
                        this.updatePlayedTimeDisplay();
                    } catch (e) {
                        console.error('Error actualizando playedMinutes:', e);
                    }
                }, 60000); // 60.000 ms = 1 minuto
            }

            window.notify({ message: `Lanzando "${options.name}"...`, type: "info" });

            const playInstanceBTN = document.querySelector('.play-instance');
            const infoStartingBOX = document.querySelector('.info-starting-game');
            const infoStarting = document.querySelector(".info-starting-game-text");
            const progressBar = document.querySelector('#play-progress') || document.querySelector('.progress-bar');
            const progressStatus = document.querySelector('.play-progress-status');
            const progressPercentMain = document.querySelector('.play-progress-percent--main');
            const subProgressContainer = document.querySelector('.sub-progress-container');
            const subProgressBar = document.querySelector('#play-subprogress') || document.querySelector('.sub-progress-bar');
            const progressPercentSub = document.querySelector('.play-progress-percent--sub');

            if (playInstanceBTN) playInstanceBTN.style.display = "none";
            if (infoStartingBOX) { infoStartingBOX.style.display = "block"; infoStartingBOX.classList.add('show'); }
            if (progressBar) progressBar.style.display = "";
             ipcRenderer.send('main-window-progress-load');
             ipcRenderer.send('new-status-discord-jugando', `Jugando a '${options.name}'`);
            try { window.customConsoleLog && window.customConsoleLog('info', `Iniciando descarga de "${options.name}"`); } catch(_) {}

            launch.on('extract', extract => {
                ipcRenderer.send('main-window-progress-load');
                console.log(extract);
            });

            launch.on('progress', (progress, size) => {
                const pct = (Number(size) > 0) ? Math.round((progress / size) * 100) : 0;
                if (infoStarting) infoStarting.innerHTML = `Descargando ${pct}%`;
                if (progressStatus) progressStatus.textContent = `Descargando (${options.name})`;
                if (progressPercentMain) progressPercentMain.textContent = `${pct}%`;
                ipcRenderer.send('main-window-progress', { progress, size });
                if (progressBar) { progressBar.value = progress; progressBar.max = size; }
                try { window.customConsoleLog && window.customConsoleLog('info', `Descarga ${options.name}: ${pct}% (${progress}/${size})`); } catch(_) {}
            });

            launch.on('check', (progress, size) => {
                const pct = (Number(size) > 0) ? Math.round((progress / size) * 100) : 0;
                if (infoStarting) infoStarting.innerHTML = `Verificando ${pct}%`;
                if (progressStatus) progressStatus.textContent = `Verificando archivos`;
                if (progressPercentMain) progressPercentMain.textContent = `${pct}%`;
                ipcRenderer.send('main-window-progress', { progress, size });
                if (progressBar) { progressBar.value = progress; progressBar.max = size; }
                try { window.customConsoleLog && window.customConsoleLog('info', `Verificando archivos: ${pct}%`); } catch(_) {}
            });

            // Ejemplo: actualizar subprogress si el evento 'sub' llega (mantener compatibilidad)
            launch.on('subprogress', (value, max) => {
                const spct = (Number(max) > 0) ? Math.round((value / max) * 100) : 0;
                if (subProgressContainer) subProgressContainer.style.display = '';
                if (subProgressBar) { subProgressBar.value = value; subProgressBar.max = max; }
                if (progressPercentSub) progressPercentSub.textContent = `${spct}%`;
            });
            
            launch.on('estimated', (time) => {
                let hours = Math.floor(time / 3600);
                let minutes = Math.floor((time - hours * 3600) / 60);
                let seconds = Math.floor(time - hours * 3600 - minutes * 60);
                console.log(`${hours}h ${minutes}m ${seconds}s`);
            });

            launch.on('speed', (speed) => console.log(`${(speed / 1067008).toFixed(2)} Mb/s`));

            launch.on('patch', patch => {
                console.log(patch);
                ipcRenderer.send('main-window-progress-load');
                if (infoStarting) infoStarting.innerHTML = `Extrayendo forge..`;
            });

            launch.on('data', (e) => {
                if (progressBar) progressBar.style.display = "none";
                if (infoStartingBOX) { infoStartingBOX.classList.remove('show'); setTimeout(()=> { if (infoStartingBOX) infoStartingBOX.style.display = 'none'; }, 260); }
                 if (configClient.launcher_config.closeLauncher == 'close-launcher') {
                     ipcRenderer.send("main-window-hide");
                 }
                 new logger('Minecraft', '#36b030');
                 ipcRenderer.send('main-window-progress-load');
                 if (infoStarting) infoStarting.innerHTML = `Playing`;
                 window.notify({ message: "Minecraft iniciado.", type: "success" });
                 console.log(e);
                 // Nota: mantenemos this.launching = true hasta que el proceso cierre.
             });

            launch.on('close', code => {
                // Reset bandera al cerrar el juego
                this.launching = false;
                // Detener timer de minutos jugados
                if (this.playTimerId) {
                    clearInterval(this.playTimerId);
                    this.playTimerId = null;
                }
                if (configClient.launcher_config.closeLauncher == 'close-launcher') {
                    ipcRenderer.send('main-window-show');
                }
                ipcRenderer.send('main-window-progress-reset');
                if (infoStartingBOX) infoStartingBOX.style.display = "none";
                if (playInstanceBTN) playInstanceBTN.style.display = "block";
                if (infoStarting) infoStarting.innerHTML = `Volviendo al juego..`;
                new logger(pkg.name, '#7289da');
                console.log('Close');
                ipcRenderer.send('delete-and-new-status-discord');
                window.notify({ message: "Juego cerrado.", type: "info" });
            });

            launch.on('error', err => {
                // Reset bandera en error
                this.launching = false;
                // Detener timer si hay error
                if (this.playTimerId) {
                    clearInterval(this.playTimerId);
                    this.playTimerId = null;
                }
                ipcRenderer.send('main-window-progress-reset');
                console.error(err);
                try { window.customConsoleLog && window.customConsoleLog('error', `Error al iniciar juego: ${String(err)}`); } catch(_) {}
                window.notify({ message: "Error al iniciar el juego.", type: "error" });
            });
        } catch (err) {
            // Reset bandera si hay excepción
            this.launching = false;
            if (this.playTimerId) {
                clearInterval(this.playTimerId);
                this.playTimerId = null;
            }
            console.error('Error al iniciar juego:', err);
            try { window.customConsoleLog && window.customConsoleLog('error', `Excepción al iniciar juego: ${String(err)}`); } catch(_) {}
            window.notify({ message: "Error al iniciar el juego.", type: "error" });
        }
     }

    initSessionInfo() {
        // Reemplazamos la lógica anterior de "session time" por el contador acumulado en minutos.
        // Carga acumulado desde localStorage y muestra en UI con título "Tiempo jugado".
        const lastSessionElem = document.getElementById('last-session');
        if (lastSessionElem) {
            const lastSession = localStorage.getItem('lastSession');
            if (lastSession && !isNaN(Number(lastSession))) {
                const date = new Date(parseInt(lastSession, 10));
                const day = date.getDate();
                const month = date.toLocaleString('es-ES', { month: 'short' });
                lastSessionElem.textContent = `${day} ${month}`;
            } else {
                lastSessionElem.textContent = '-';
            }
        }

        // Crear (si no existe) el bloque que muestra "Tiempo jugado"
        if (!document.getElementById('session-time')) {
            const sessionInfoBlock = document.querySelector('.compact-session-info');
            if (sessionInfoBlock) {
                const div = document.createElement('div');
                div.className = 'session-info-item';
                div.innerHTML = `<div class="session-info-title">Tiempo jugado</div><div class="session-info-value" id="session-time">0m</div>`;
                sessionInfoBlock.appendChild(div);
            }
        } else {
            // Asegurar que el título sea el correcto por si se creó en otro lugar
            const parent = document.getElementById('session-time')?.closest('.session-info-item');
            if (parent) {
                const title = parent.querySelector('.session-info-title');
                if (title) title.textContent = 'Tiempo jugado';
            }
        }

        // Inicializar valor desde localStorage
        this.playedMinutes = parseInt(localStorage.getItem('playedMinutes') || '0', 10) || 0;
        this.updatePlayedTimeDisplay();

        // No usamos intervalos por segundo: el contador "suma" solo mientras juegas y cada 1 minuto.
        // Guardar la última sesión al cerrar o recargar (se mantiene)
        window.addEventListener('beforeunload', () => {
            localStorage.setItem('lastSession', Date.now().toString());
        });
    }

    // Nueva función: actualiza el texto visible con formato H M
    updatePlayedTimeDisplay() {
        const sessionTimeElem = document.getElementById('session-time');
        if (!sessionTimeElem) return;
        sessionTimeElem.textContent = this.formatPlayedMinutes(this.playedMinutes);
    }

    // Nuevo: formato legible para minutos acumulados
    formatPlayedMinutes(totalMinutes) {
        totalMinutes = Number(totalMinutes) || 0;
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }

    getdate(e) {
        let date = new Date(e)
        let year = date.getFullYear()
        let month = date.getMonth() + 1
        let day = date.getDate()
        let allMonth = ['n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n']
        return { year: year, month: allMonth[month - 1], day: day }
    }

    // Inicializa el overlay/preview del nombre de cuenta al pasar por .head-frame
    initAccountPreviewHandlers() {
        const headFrame = document.querySelector('.head-frame');
        if (!headFrame) return;

        // Evita crear múltiples veces
        if (this._accountPreviewInitialized) return;
        this._accountPreviewInitialized = true;

        // Crear elemento preview si no existe
        let preview = document.querySelector('.account-preview');
        if (!preview) {
            preview = document.createElement('div');
            preview.className = 'account-preview';
            preview.setAttribute('role', 'tooltip');
            preview.setAttribute('aria-hidden', 'true');
            document.body.appendChild(preview);
        }

        const showPreview = async () => {
            try {
                const cfg = await this.db.readData('configClient').catch(()=>({}));
                const accId = cfg.account_selected;
                let displayName = 'Cuenta';
                if (accId) {
                    const acc = await this.db.readData('accounts', accId).catch(()=>null);
                    if (acc) displayName = acc.name || acc.username || acc.displayName || acc.email || displayName;
                } else {
                    // fallback: si no hay account_selected, intentar usar primer account en DB
                    const all = await this.db.readAllData('accounts').catch(()=>[]);
                    if (Array.isArray(all) && all.length) displayName = all[0].name || all[0].username || displayName;
                }

                // Respetar streamer mode (mask)
                if (document.body.classList.contains('streamer-mode') || (window.StreamerMode && window.StreamerMode.enabled)) {
                    displayName = 'Streamer';
                }

                preview.textContent = displayName;
                preview.setAttribute('aria-hidden', 'false');
                preview.classList.add('show');

                // Posicionar cerca de headFrame (preferir debajo)
                const rect = headFrame.getBoundingClientRect();
                const previewWidth = Math.min(260, Math.max(120, Math.floor(window.innerWidth * 0.18)));
                const previewHeight = preview.offsetHeight || 36;
                let left = rect.right + 8;
                // si se sale a la derecha, poner a la izquierda
                if (left + previewWidth > window.innerWidth - 12) left = rect.left - previewWidth - 8;
                if (left < 8) left = 8;
                let top = rect.bottom + 8;
                if (top + previewHeight > window.innerHeight - 12) top = rect.top - previewHeight - 8;
                if (top < 8) top = 8;
                preview.style.left = `${left}px`;
                preview.style.top = `${top}px`;
                preview.style.width = `${previewWidth}px`;
            } catch (e) { console.warn('showPreview error', e); }
        };

        const hidePreview = () => {
            if (!preview) return;
            preview.classList.remove('show');
            preview.setAttribute('aria-hidden', 'true');
        };

        // Eventos: pointer (mouse/touch) y keyboard focus (accesibilidad)
        headFrame.addEventListener('pointerenter', showPreview);
        headFrame.addEventListener('pointerleave', hidePreview);
        headFrame.addEventListener('focus', showPreview, true);
        headFrame.addEventListener('blur', hidePreview, true);

        // Si la ventana se redimensiona u ocurre scroll, reposicionar si está visible
        window.addEventListener('scroll', () => {
            if (preview && preview.classList.contains('show')) showPreview();
        }, { passive: true });
        window.addEventListener('resize', () => {
            if (preview && preview.classList.contains('show')) showPreview();
        });
    }

    // Refresca recursos del launcher sin reiniciar
    async refreshLauncherResources() {
        try {
            const cfg = await this.db.readData('configClient').catch(()=>({}));
            const auth = cfg.account_selected ? await this.db.readData('accounts', cfg.account_selected).catch(()=>null) : null;

            let instancesList = await config.getInstanceList() || [];
            let localAdded = await this.db.readAllData('addedInstances').catch(() => []);
            if (!Array.isArray(localAdded)) localAdded = [];
            instancesList = instancesList.concat(localAdded.map(li => Object.assign({}, li, { _local: true, _localId: li.ID })));

            // actualizar sidebar y selección
            try { await this.instancesSelect(); } catch (e) { console.warn('instancesSelect refresh failed', e); }

            // repoblar menú si está cargado
            if (this.instanceMenuList) {
                try { this.populateInstanceMenu(instancesList, auth); } catch (e) { console.warn('populateInstanceMenu failed', e); }
            }

            // actualizar covers visibles
            try {
                const mapByName = {};
                for (const inst of instancesList) mapByName[inst.name] = inst;
                document.querySelectorAll('.instances-grid .sidebar-instance').forEach(el => {
                    const name = el.getAttribute('data-instance-name');
                    const inst = mapByName[name];
                    if (inst) {
                        const coverEl = el.querySelector('.sidebar-instance-cover');
                        const cover = inst.cover ? inst.cover : 'assets/images/default/default_cover.jpg';
                        if (coverEl && (!coverEl.style.backgroundImage || coverEl.style.backgroundImage.indexOf(cover) === -1)) {
                            coverEl.style.backgroundImage = `url('${cover}')`;
                        }
                    }
                });
            } catch (e) { console.warn('update covers failed', e); }

            // actualizar fondo de home según instancia seleccionada
            try {
                const cfg2 = await this.db.readData('configClient').catch(()=>({}));
                const selectedName = cfg2.instance_selct;
                const selected = instancesList.find(i => i && i.name === selectedName);
                if (selected && selected.background) {
                    window.setHomeBackgroundMedia(selected.background);
                } else {
                    const lastBg = localStorage.getItem('lastInstanceBackground');
                    if (lastBg) window.setHomeBackgroundMedia(lastBg);
                }
            } catch (e) { console.warn('update background failed', e); }

            // reaplicar música/news/socials/account preview
            try { await this.playMusicForCurrentInstance(); } catch (e) {}
            try { this.news(); } catch (e) {}
            try { this.socialLick(); } catch (e) {}
            try { this.initAccountPreviewHandlers(); } catch (e) {}

            window.notify({ message: "Launcher actualizado.", type: "success", timeout: 1400 });
            return true;
        } catch (err) {
            console.error('refreshLauncherResources error', err);
            window.notify({ message: "Error al actualizar el launcher.", type: "error" });
            return false;
        }
    }
}

// Exponer helper global por si otro módulo quiere forzar refresh
try {
    window.refreshLauncher = async () => {
        if (window._homeInstance && typeof window._homeInstance.refreshLauncherResources === 'function') {
            return window._homeInstance.refreshLauncherResources();
        }
        return false;
    };
} catch (e) { /* noop */ }

// Función global para fondo animado (debe estar solo una vez en el proyecto)
window.setHomeBackgroundMedia = function(url) {
    let bgMedia = document.querySelector('.home-bg-media');
    if (!bgMedia) {
        bgMedia = document.createElement('div');
        bgMedia.className = 'home-bg-media';
        document.body.insertBefore(bgMedia, document.body.firstChild);
    }
    bgMedia.innerHTML = '';
    if (!url) return;
    const ext = url.split('.').pop().toLowerCase();
    if (['mp4', 'webm', 'ogg'].includes(ext)) {
        const video = document.createElement('video');
        video.src = url;
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'cover';
        bgMedia.appendChild(video);
    } else if (['gif', 'apng', 'png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = 'background';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        bgMedia.appendChild(img);
    }
    localStorage.setItem('lastInstanceBackground', url);
}

// Hook notify to respect Streamer Mode masking without touching original implementation
;(function hookNotifyForStreamerMode(){
    if (typeof window !== 'undefined' && typeof window.notify === 'function') {
        const _orig = window.notify;
        window.notify = function(props){
            const data = Object.assign({ type: 'info', timeout: 2200 }, props || {});
            if (window.StreamerMode && window.StreamerMode.enabled) {
                data.message = data.type === 'error' ? 'Error' : 'Notificación';
            }
            return _orig.call(this, data);
        }
    }
})();

export default Home;