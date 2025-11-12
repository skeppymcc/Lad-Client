/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

import { changePanel, accountSelect, database, Slider, config, setStatus, popup, appdata, setBackground } from '../utils.js'
const { ipcRenderer } = require('electron');
const os = require('os');

class Settings {
    static id = "settings";
    async init(config) {
        // --- Mantener/Restaurar el fondo de home en settings ---
        let bgMedia = document.querySelector('.home-bg-media');
        if (!bgMedia) {
            // Si no existe (por ejemplo, acceso directo a settings), créalo y usa el último fondo guardado
            bgMedia = document.createElement('div');
            bgMedia.className = 'home-bg-media';
            document.body.insertBefore(bgMedia, document.body.firstChild);

            // Recupera el último fondo de instancia activa de localStorage (debe ser guardado por home.js)
            const lastBg = localStorage.getItem('lastInstanceBackground');
            if (lastBg) {
                setHomeBackgroundMedia(lastBg);
            }
        } else {
            // Si hay video, asegúrate que siga reproduciéndose
            const video = bgMedia.querySelector('video');
            if (video && video.paused) {
                try { video.play(); } catch (e) {}
            }
        }

        this.config = config;
        this.db = new database();
        this.navBTN()
        this.accounts()
        this.ram()
        this.javaPath()
        this.resolution()
        this.launcher()
    }

    navBTN() {
        // Inicialización: transformar los botones de texto en botones con icono + texto accesible
        const navButtons = document.querySelectorAll('.nav-settings-btn');
        navButtons.forEach(btn => {
            // guardar label original
            const label = (btn.textContent || btn.innerText || '').trim();
            // si ya transformado, saltar
            if (btn.querySelector('.nav-icon')) {
                btn.setAttribute('aria-label', label || btn.id);
                btn.setAttribute('role', 'button');
                btn.setAttribute('tabindex', '0');
                return;
            }
            // sustituir contenido por icon + hidden text (mantener accesibilidad)
            btn.innerHTML = `<span class="nav-icon" aria-hidden="true"></span><span class="nav-text">${label}</span>`;
            btn.setAttribute('aria-label', label || btn.id);
            btn.setAttribute('role', 'button');
            btn.setAttribute('tabindex', '0');

            // Allow keyboard activation (Enter / Space)
            btn.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    btn.click();
                }
            });
        });

        // Delegated click handler: mantiene la lógica previa
        document.querySelector('.nav-box').addEventListener('click', e => {
            // Normalize target (may be the inner span)
            let target = e.target.closest('.nav-settings-btn');
            if (!target) return;
            if (target.classList.contains('nav-settings-btn')) {
                let id = target.id;

                let activeSettingsBTN = document.querySelector('.active-settings-BTN');
                let activeContainerSettings = document.querySelector('.active-container-settings');

                if (id == 'save') {
                    if (activeSettingsBTN) activeSettingsBTN.classList.toggle('active-settings-BTN');
                    document.querySelector('#account').classList.add('active-settings-BTN');

                    if (activeContainerSettings) activeContainerSettings.classList.toggle('active-container-settings');
                    document.querySelector(`#account-tab`).classList.add('active-container-settings');
                    return changePanel('home');
                }

                if (activeSettingsBTN) activeSettingsBTN.classList.toggle('active-settings-BTN');
                target.classList.add('active-settings-BTN');

                if (activeContainerSettings) activeContainerSettings.classList.toggle('active-container-settings');
                document.querySelector(`#${id}-tab`).classList.add('active-container-settings');
            }
        });
    }

    accounts() {
        document.querySelector('.accounts-list').addEventListener('click', async e => {
            let popupAccount = new popup()
            try {
                let id = e.target.id
                if (e.target.classList.contains('account')) {
                    popupAccount.openPopup({
                        title: 'Cargando Cuenta',
                        content: 'Porfavor espere...',
                        color: 'var(--color)'
                    })

                    if (id == 'add') {
                        document.querySelector('.cancel-home').style.display = 'inline'
                        return changePanel('login')
                    }

                    let account = await this.db.readData('accounts', id);
                    let configClient = await this.setInstance(account);
                    await accountSelect(account);
                    configClient.account_selected = account.ID;
                    return await this.db.updateData('configClient', configClient);
                }

                if (e.target.classList.contains("delete-profile")) {
                    popupAccount.openPopup({
                        title: 'Cargando Cuenta...',
                        content: 'Porfavor espere...',
                        color: 'var(--color)'
                    })
                    await this.db.deleteData('accounts', id);
                    let deleteProfile = document.getElementById(`${id}`);
                    let accountListElement = document.querySelector('.accounts-list');
                    accountListElement.removeChild(deleteProfile);

                    if (accountListElement.children.length == 1) return changePanel('login');

                    let configClient = await this.db.readData('configClient');

                    if (configClient.account_selected == id) {
                        let allAccounts = await this.db.readAllData('accounts');
                        configClient.account_selected = allAccounts[0].ID
                        accountSelect(allAccounts[0]);
                        let newInstanceSelect = await this.setInstance(allAccounts[0]);
                        configClient.instance_selct = newInstanceSelect.instance_selct
                        return await this.db.updateData('configClient', configClient);
                    }
                }
            } catch (err) {
                console.error(err)
            } finally {
                popupAccount.closePopup();
            }
        })
    }

    async setInstance(auth) {
        let configClient = await this.db.readData('configClient')
        let instanceSelect = configClient.instance_selct
        let instancesList = await config.getInstanceList()

        for (let instance of instancesList) {
            if (instance.whitelistActive) {
                let whitelist = instance.whitelist.find(whitelist => whitelist == auth.name)
                if (whitelist !== auth.name) {
                    if (instance.name == instanceSelect) {
                        let newInstanceSelect = instancesList.find(i => i.whitelistActive == false)
                        configClient.instance_selct = newInstanceSelect.name
                        await setStatus(newInstanceSelect.status)
                    }
                }
            }
        }
        return configClient
    }

    async ram() {
        let config = await this.db.readData('configClient') || {};
        // Asegurar estructura mínima
        config.java_config = config.java_config || {};
        config.java_config.java_memory = config.java_config.java_memory || { min: 2, max: 4 };

        let totalMem = Math.trunc(os.totalmem() / 1073741824 * 10) / 10;
        let freeMem = Math.trunc(os.freemem() / 1073741824 * 10) / 10;

        const totalRamEl = document.getElementById("total-ram");
        const freeRamEl = document.getElementById("free-ram");
        if (totalRamEl) totalRamEl.textContent = `${totalMem} GB`;
        if (freeRamEl) freeRamEl.textContent = `${freeMem} GB`;

        let sliderDiv = document.querySelector(".memory-slider");
        if (sliderDiv) sliderDiv.setAttribute("max", Math.trunc((80 * totalMem) / 100));

        let ram = config?.java_config?.java_memory ? {
            ramMin: config.java_config.java_memory.min,
            ramMax: config.java_config.java_memory.max
        } : { ramMin: "1", ramMax: "2" };

        if (totalMem < ram.ramMin) {
            config.java_config.java_memory = { min: 1, max: 2 };
            await this.db.updateData('configClient', config);
            ram = { ramMin: "1", ramMax: "2" }
        };

        let slider = new Slider(".memory-slider", parseFloat(ram.ramMin), parseFloat(ram.ramMax));

        let minSpan = document.querySelector(".slider-touch-left span");
        let maxSpan = document.querySelector(".slider-touch-right span");

        if (minSpan) minSpan.setAttribute("value", `${ram.ramMin} Go`);
        if (maxSpan) maxSpan.setAttribute("value", `${ram.ramMax} Go`);

        slider.on("change", async (min, max) => {
            let cfg = await this.db.readData('configClient') || {};
            cfg.java_config = cfg.java_config || {};
            cfg.java_config.java_memory = { min: min, max: max };
            if (minSpan) minSpan.setAttribute("value", `${min} GB`);
            if (maxSpan) maxSpan.setAttribute("value", `${max} GB`);
            await this.db.updateData('configClient', cfg);
        });
    }

    async javaPath() {
        let javaPathText = document.querySelector(".java-path-txt")
        javaPathText && (javaPathText.textContent = `${await appdata()}/${process.platform == 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}/runtime`);

        let configClient = await this.db.readData('configClient') || {};
        configClient.java_config = configClient.java_config || {};
        let javaPath = configClient?.java_config?.java_path || 'Utilice la versión de java suministrada con el lanzador';
        let javaPathInputTxt = document.querySelector(".java-path-input-text");
        let javaPathInputFile = document.querySelector(".java-path-input-file");
        if (javaPathInputTxt) javaPathInputTxt.value = javaPath;

        const javaSetBtn = document.querySelector(".java-path-set");
        const javaResetBtn = document.querySelector(".java-path-reset");
        if (javaSetBtn && javaPathInputFile && javaPathInputTxt) {
            javaSetBtn.addEventListener("click", async () => {
                javaPathInputFile.value = '';
                javaPathInputFile.click();
                await new Promise((resolve) => {
                    let interval;
                    interval = setInterval(() => {
                        if (javaPathInputFile.value != '') resolve(clearInterval(interval));
                    }, 100);
                });

                if (javaPathInputFile.value.replace(".exe", '').endsWith("java") || javaPathInputFile.value.replace(".exe", '').endsWith("javaw")) {
                    let cfg = await this.db.readData('configClient') || {};
                    cfg.java_config = cfg.java_config || {};
                    let file = javaPathInputFile.files[0].path;
                    javaPathInputTxt.value = file;
                    cfg.java_config.java_path = file
                    await this.db.updateData('configClient', cfg);
                } else alert("El nombre del archivo debe ser java o javaw");
            });
        }

        if (javaResetBtn && javaPathInputTxt) {
            javaResetBtn.addEventListener("click", async () => {
                let cfg = await this.db.readData('configClient') || {};
                cfg.java_config = cfg.java_config || {};
                javaPathInputTxt.value = 'Utilice la versión de java suministrada con el lanzador';
                cfg.java_config.java_path = null
                await this.db.updateData('configClient', cfg);
            });
        }
    }

    async resolution() {
        let configClient = await this.db.readData('configClient') || {};
        configClient.game_config = configClient.game_config || {};
        configClient.game_config.screen_size = configClient.game_config.screen_size || { width: 1920, height: 1080 };
        let resolution = configClient.game_config.screen_size;

        let width = document.querySelector(".width-size");
        let height = document.querySelector(".height-size");
        let resolutionReset = document.querySelector(".size-reset");

        if (width) width.value = resolution.width;
        if (height) height.value = resolution.height;

        width?.addEventListener("change", async () => {
            let cfg = await this.db.readData('configClient') || {};
            cfg.game_config = cfg.game_config || {};
            cfg.game_config.screen_size = cfg.game_config.screen_size || {};
            cfg.game_config.screen_size.width = width.value;
            await this.db.updateData('configClient', cfg);
        })

        height?.addEventListener("change", async () => {
            let cfg = await this.db.readData('configClient') || {};
            cfg.game_config = cfg.game_config || {};
            cfg.game_config.screen_size = cfg.game_config.screen_size || {};
            cfg.game_config.screen_size.height = height.value;
            await this.db.updateData('configClient', cfg);
        })

        resolutionReset?.addEventListener("click", async () => {
            let cfg = await this.db.readData('configClient') || {};
            cfg.game_config = cfg.game_config || {};
            cfg.game_config.screen_size = { width: '854', height: '480' };
            if (width) width.value = '854';
            if (height) height.value = '480';
            await this.db.updateData('configClient', cfg);
        })
    }

    async launcher() {
        let configClient = await this.db.readData('configClient') || {};
        configClient.launcher_config = configClient.launcher_config || {};

        let maxDownloadFiles = configClient.launcher_config.download_multi || 5;
        let maxDownloadFilesInput = document.querySelector(".max-files");
        let maxDownloadFilesReset = document.querySelector(".max-files-reset");
        if (maxDownloadFilesInput) maxDownloadFilesInput.value = maxDownloadFiles;

        maxDownloadFilesInput?.addEventListener("change", async () => {
            let cfg = await this.db.readData('configClient') || {};
            cfg.launcher_config = cfg.launcher_config || {};
            cfg.launcher_config.download_multi = maxDownloadFilesInput.value;
            await this.db.updateData('configClient', cfg);
        })

        maxDownloadFilesReset?.addEventListener("click", async () => {
            let cfg = await this.db.readData('configClient') || {};
            cfg.launcher_config = cfg.launcher_config || {};
            if (maxDownloadFilesInput) maxDownloadFilesInput.value = 5
            cfg.launcher_config.download_multi = 5;
            await this.db.updateData('configClient', cfg);
        })

        let themeBox = document.querySelector(".theme-box");
        let theme = configClient.launcher_config.theme || "auto";

        if (theme == "auto") {
            document.querySelector('.theme-btn-auto')?.classList.add('active-theme');
        } else if (theme == "dark") {
            document.querySelector('.theme-btn-sombre')?.classList.add('active-theme');
        } else if (theme == "light") {
            document.querySelector('.theme-btn-clair')?.classList.add('active-theme');
        } else if (configClient.launcher_config.custom_theme?.enabled) {
            document.querySelector('.theme-btn-custom')?.classList.add('active-theme');
            document.querySelector('.theme-customizer')?.setAttribute('style','display:grid;');
        }

        themeBox?.addEventListener("click", async e => {
            if (e.target.classList.contains('theme-btn')) {
                let activeTheme = document.querySelector('.active-theme');
                if (e.target.classList.contains('active-theme')) return
                activeTheme?.classList.remove('active-theme');

                if (e.target.classList.contains('theme-btn-auto')) {
                    setBackground();
                    theme = "auto";
                    e.target.classList.add('active-theme');
                } else if (e.target.classList.contains('theme-btn-sombre')) {
                    setBackground(true);
                    theme = "dark";
                    e.target.classList.add('active-theme');
                } else if (e.target.classList.contains('theme-btn-clair')) {
                    setBackground(false);
                    theme = "light";
                    e.target.classList.add('active-theme');
                } else if (e.target.classList.contains('theme-btn-custom')) {
                    theme = configClient.launcher_config.theme || 'auto';
                    e.target.classList.add('active-theme');
                    document.querySelector('.theme-customizer')?.setAttribute('style','display:grid;');
                }

                let cfg = await this.db.readData('configClient') || {};
                cfg.launcher_config = cfg.launcher_config || {};
                cfg.launcher_config.theme = theme;
                await this.db.updateData('configClient', cfg);
            }
        })

        // Theme customizer wiring
        const customizer = document.querySelector('.theme-customizer');
        const customEnabled = document.querySelector('.theme-custom-enabled');
        const inputs = [
            { sel: '.theme-color', key: 'color' },
            { sel: '.theme-background', key: 'background' },
            { sel: '.theme-background-element', key: 'backgroundElement' },
            { sel: '.theme-accent', key: 'elementColor' },
        ];

        if (customizer) {
            // Initialize from config
            const c = (configClient?.launcher_config?.custom_theme) || {};
            if (typeof c.enabled === 'boolean') customEnabled.checked = !!c.enabled;
            inputs.forEach(it => {
                const el = document.querySelector(it.sel);
                if (el && c[it.key]) el.value = c[it.key].startsWith('#') ? c[it.key] : el.value;
            });
            // Show customizer if selected previously
            if (document.querySelector('.theme-btn-custom') && document.querySelector('.theme-btn-custom').classList.contains('active-theme')) {
                customizer.style.display = 'grid';
            }

            const applyNow = async () => {
                let configClient = await this.db.readData('configClient');
                configClient.launcher_config.custom_theme = configClient.launcher_config.custom_theme || {};
                configClient.launcher_config.custom_theme.enabled = !!customEnabled.checked;
                inputs.forEach(it => {
                    const el = document.querySelector(it.sel);
                    if (el && el.value) configClient.launcher_config.custom_theme[it.key] = el.value;
                });
                // Autogenerate backgroundTransparent from background
                const bg = configClient.launcher_config.custom_theme.background || '#292929';
                configClient.launcher_config.custom_theme.backgroundTransparent = `rgba(${parseInt(bg.slice(1,3),16)},${parseInt(bg.slice(3,5),16)},${parseInt(bg.slice(5,7),16)},0.8)`;
                await this.db.updateData('configClient', configClient);
                setBackground();
            };

            customEnabled?.addEventListener('change', applyNow);
            inputs.forEach(it => {
                const el = document.querySelector(it.sel);
                el?.addEventListener('input', applyNow);
            });

            const resetBtn = document.querySelector('.theme-reset-btn');
            resetBtn?.addEventListener('click', async () => {
                let configClient = await this.db.readData('configClient');
                configClient.launcher_config.custom_theme = {
                    enabled: false,
                    color: '#F5F5F5',
                    background: '#292929',
                    backgroundElement: '#424242',
                    backgroundTransparent: 'rgba(44,44,44,0.8)',
                    elementColor: '#0078bd'
                };
                await this.db.updateData('configClient', configClient);
                // Reset inputs and disable
                customEnabled.checked = false;
                inputs.forEach(it => {
                    const el = document.querySelector(it.sel);
                    if (el) {
                        if (it.key === 'color') el.value = '#F5F5F5';
                        if (it.key === 'background') el.value = '#292929';
                        if (it.key === 'backgroundElement') el.value = '#424242';
                        if (it.key === 'elementColor') el.value = '#0078bd';
                    }
                })
                setBackground();
            })
        }

        // El bloque "close-box" puede no existir en el DOM (está comentado en el HTML).
        // Comprobamos existencia antes de manipular elementos.
        let closeBox = document.querySelector(".close-box");
        let closeLauncher = configClient.launcher_config.closeLauncher || "close-launcher";
        const closeLauncherEl = document.querySelector('.close-launcher');
        const closeAllEl = document.querySelector('.close-all');
        const closeNoneEl = document.querySelector('.close-none');

        if (closeLauncher === "close-launcher" && closeLauncherEl) {
            closeLauncherEl.classList.add('active-close');
        } else if (closeLauncher === "close-all" && closeAllEl) {
            closeAllEl.classList.add('active-close');
        } else if (closeLauncher === "close-none" && closeNoneEl) {
            closeNoneEl.classList.add('active-close');
        }

        if (closeBox) {
            closeBox.addEventListener("click", async e => {
                if (e.target.classList.contains('close-btn')) {
                    let activeClose = document.querySelector('.active-close');
                    if (e.target.classList.contains('active-close')) return
                    activeClose?.classList.toggle('active-close');

                    let cfg = await this.db.readData('configClient') || {};
                    cfg.launcher_config = cfg.launcher_config || {};

                    if (e.target.classList.contains('close-launcher')) {
                        e.target.classList.toggle('active-close');
                        cfg.launcher_config.closeLauncher = "close-launcher";
                        await this.db.updateData('configClient', cfg);
                    } else if (e.target.classList.contains('close-all')) {
                        e.target.classList.toggle('active-close');
                        cfg.launcher_config.closeLauncher = "close-all";
                        await this.db.updateData('configClient', cfg);
                    } else if (e.target.classList.contains('close-none')) {
                        e.target.classList.toggle('active-close');
                        cfg.launcher_config.closeLauncher = "close-none";
                        await this.db.updateData('configClient', cfg);
                    }
                }
            })
        }

        // --- Discord Rich Presence ---
        const discordSwitch = document.querySelector('.discord-rpc-switch');
        if (discordSwitch) {
            discordSwitch.checked = !!configClient?.launcher_config?.discord_rpc?.enabled;
            discordSwitch.addEventListener('change', async () => {
                let configClient = await this.db.readData('configClient');
                configClient.launcher_config.discord_rpc = configClient.launcher_config.discord_rpc || {};
                configClient.launcher_config.discord_rpc.enabled = discordSwitch.checked;
                await this.db.updateData('configClient', configClient);
            });
        }
    }
}
export default Settings;

// --- Función global para restaurar fondo (debe estar en utils.js o en home.js) ---
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
    // Guarda el último fondo para restaurar en settings si es necesario
    localStorage.setItem('lastInstanceBackground', url);
}
