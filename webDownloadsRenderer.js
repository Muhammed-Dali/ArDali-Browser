// webDownloadsRenderer.js

document.addEventListener('DOMContentLoaded', () => {
    const api = window.ardali?.downloads;
    if (!api) {
        console.warn('Downloads API not found');
        return;
    }

    const btnDownloads = document.getElementById('webNavDownloads');
    const popup = document.getElementById('downloadsPopup');
    const popupList = document.getElementById('downloadsPopupList');
    const popupClearBtn = document.getElementById('downloadsPopupClearBtn');
    const popupShowAllBtn = document.getElementById('downloadsPopupShowAllBtn');

    const downloadsPage = document.getElementById('webDownloadsPage');
    const pageCloseBtn = document.getElementById('webDownloadsCloseBtn');
    const pageClearAllBtn = document.getElementById('webDownloadsClearAllBtn');
    const pageContent = document.getElementById('webDownloadsContent');

    let isPopupOpen = false;
    const isPageOpen = () => !downloadsPage.classList.contains('hidden');
    let downloadsHistory = [];
    let isBraveDetailsExpanded = false;
    const animatedDownloads = new Set();
    let downloadsPageSignature = '';

    function isActiveDownloadState(state) {
        return state === 'downloading' || state === 'paused' || state === 'waiting_for_save';
    }

    function isDownloadsPageActive() {
        const activeUrl = window.getActiveTabUrl ? window.getActiveTabUrl() : null;
        return activeUrl === 'ardali://downloads';
    }

    function openDownloadsPopup() {
        if (isDownloadsPageActive()) return;
        isPopupOpen = true;
        if (popup) popup.classList.remove('hidden');
        if (btnDownloads) btnDownloads.classList.add('active');
        renderPopup();
    }

    function closeDownloadsPopup() {
        isPopupOpen = false;
        if (popup) popup.classList.add('hidden');
        if (btnDownloads) btnDownloads.classList.remove('active');
    }

    function ensureDownloadAnimationStyles() {
        if (document.getElementById('brave-download-anims')) return;
        const style = document.createElement('style');
        style.id = 'brave-download-anims';
        style.setAttribute('nonce', 'ardali-local-style-v1');
        style.textContent = `
            @keyframes braveIndeterminate {
                0% { transform: translateX(-120%); }
                50% { transform: translateX(335%); }
                100% { transform: translateX(-120%); }
            }
            .brave-download-flyer {
                position: fixed;
                z-index: 999999;
                pointer-events: none;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 64px;
                height: 64px;
                border-radius: 50%;
                background: color-mix(in srgb, var(--theme-base, #1f2430) 88%, var(--theme-accent, #8ab4f8));
                color: var(--theme-accent, #8ab4f8);
                box-shadow: 0 14px 34px rgba(0, 0, 0, 0.42), inset 0 0 0 1px rgba(255,255,255,0.08);
                opacity: 0;
                transform: translate(-50%, -50%) scale(0.68);
                transition:
                    left 1080ms cubic-bezier(0.16, 1, 0.3, 1),
                    top 1080ms cubic-bezier(0.16, 1, 0.3, 1),
                    opacity 220ms ease,
                    transform 1080ms cubic-bezier(0.16, 1, 0.3, 1);
                will-change: left, top, transform, opacity;
            }
            .brave-download-flyer .material-symbols-rounded {
                font-size: 34px;
                font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 32;
            }
            .brave-download-target-pulse {
                animation: braveDownloadTargetPulse 620ms cubic-bezier(0.16, 1, 0.3, 1);
            }
            @keyframes braveDownloadTargetPulse {
                0% { transform: scale(1); filter: brightness(1); }
                42% { transform: scale(1.12); filter: brightness(1.3); }
                100% { transform: scale(1); filter: brightness(1); }
            }
            body.ardali-reduced-motion .brave-download-flyer {
                transition-duration: 1080ms, 1080ms, 220ms, 1080ms !important;
            }
            body.ardali-reduced-motion .brave-download-target-pulse {
                animation-duration: 620ms !important;
                animation-iteration-count: 1 !important;
            }
        `;
        document.head.appendChild(style);
    }

    if (btnDownloads) {
        btnDownloads.style.position = 'relative';
        const ringSvg = `
            <svg id="webDownloadsProgressRing" viewBox="0 0 36 36" style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%) rotate(-90deg); width:32px; height:32px; pointer-events:none; opacity:0; transition:opacity 0.3s;">
                <circle cx="18" cy="18" r="15" fill="none" stroke="var(--bg-tertiary)" stroke-width="2" />
                <circle id="webDownloadsProgressValue" cx="18" cy="18" r="15" fill="none" stroke="var(--accent-primary)" stroke-width="2" stroke-dasharray="94.248" stroke-dashoffset="94.248" stroke-linecap="round" style="transition: stroke-dashoffset 0.3s linear;" />
            </svg>
        `;
        btnDownloads.insertAdjacentHTML('beforeend', ringSvg);
    }

    function updateGlobalProgressRing() {
        const ringSvg = document.getElementById('webDownloadsProgressRing');
        const ringValue = document.getElementById('webDownloadsProgressValue');
        if (!ringSvg || !ringValue) return;

        const activeDownloads = downloadsHistory.filter(d => d.state === 'downloading');
        
        if (activeDownloads.length === 0) {
            ringSvg.style.opacity = '0';
            ringValue.style.strokeDashoffset = '94.248';
            return;
        }

        let totalReceived = 0;
        let totalBytes = 0;
        activeDownloads.forEach(d => {
            totalReceived += d.receivedBytes || 0;
            totalBytes += d.totalBytes || 0;
        });

        let progressPercent = 0;
        if (totalBytes > 0) {
            progressPercent = (totalReceived / totalBytes) * 100;
        }

        ringSvg.style.opacity = '1';
        const offset = 94.248 - (progressPercent / 100) * 94.248;
        ringValue.style.strokeDashoffset = offset;
    }

    // --- Format Utils ---
    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function formatDate(timestamp) {
        const date = new Date(timestamp);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) {
            return 'Bugün';
        } else if (date.toDateString() === yesterday.toDateString()) {
            return 'Dün';
        } else {
            return date.toLocaleDateString();
        }
    }

    function formatEta(seconds) {
        if (!seconds || !isFinite(seconds)) return '';
        if (seconds < 60) return `${Math.round(seconds)} sn kaldı`;
        const mins = Math.floor(seconds / 60);
        if (mins < 60) return `${mins} dk kaldı`;
        const hrs = Math.floor(mins / 60);
        return `${hrs} sa ${mins % 60} dk kaldı`;
    }

    // --- State & Render ---
    async function loadHistory() {
        downloadsHistory = await api.getHistory();
        if (isPopupOpen) renderPopup();
        if (isPageOpen()) renderPage();
        updateGlobalProgressRing();
    }

    async function checkFileStatus(item) {
        if (item.state === 'completed' && item.savePath) {
            const exists = await api.checkExists(item.savePath);
            return exists;
        }
        return false;
    }

    function getItemRenderState(item) {
        let icon = 'description';
        let statusText = '';
        let showProgress = false;
        let progressPercent = 0;
        let stateClass = '';

        if (item.state === 'downloading' || item.state === 'paused') {
            icon = item.state === 'paused' ? 'pause_circle' : 'download';
            showProgress = true;
            const statePrefix = item.state === 'paused' ? 'Duraklatıldı - ' : '';
            if (item.totalBytes > 0) {
                progressPercent = (item.receivedBytes / item.totalBytes) * 100;
                statusText = `${statePrefix}${formatBytes(item.receivedBytes)} / ${formatBytes(item.totalBytes)}`;
            } else {
                statusText = `${statePrefix}${formatBytes(item.receivedBytes)} indirildi`;
            }
        } else if (item.state === 'waiting_for_save') {
            statusText = 'Kaydetme bekleniyor...';
            icon = 'more_horiz';
            showProgress = true;
        } else if (item.state === 'completed') {
            icon = 'check_circle';
            statusText = formatBytes(item.totalBytes);
            stateClass = 'completed';
        } else if (item.state === 'cancelled') {
            icon = 'cancel';
            statusText = item.cancelReason === 'app_closed'
                ? 'Uygulama kapandığı için iptal edildi'
                : 'İptal edildi';
            stateClass = 'cancelled';
        } else if (item.state === 'interrupted') {
            icon = 'error';
            statusText = 'Başarısız oldu';
            stateClass = 'interrupted';
        }

        return { icon, statusText, showProgress, progressPercent, stateClass };
    }

    function applyItemStateClasses(el, stateClass) {
        el.classList.remove('completed', 'cancelled', 'interrupted');
        if (stateClass) el.classList.add(stateClass);
    }

    function getPageItemSignature(item) {
        return [
            item.id,
            item.state,
            item.fileName || '',
            item.savePath || '',
            item.startTime || '',
            item.totalBytes || 0
        ].join('|');
    }

    function getPageSignature(groups) {
        return Object.entries(groups).map(([dateLabel, items]) => {
            return `${dateLabel}:${items.map(getPageItemSignature).join(',')}`;
        }).join(';');
    }

    function updateItemElement(el, item) {
        const renderState = getItemRenderState(item);
        applyItemStateClasses(el, renderState.stateClass);

        const icon = el.querySelector('[data-download-role="icon"] .material-symbols-rounded');
        if (icon) icon.textContent = renderState.icon;

        const nameDiv = el.querySelector('[data-download-role="filename"]');
        if (nameDiv) nameDiv.textContent = item.fileName || 'İndirme';

        const statusDiv = el.querySelector('[data-download-role="status"]');
        if (statusDiv) statusDiv.textContent = renderState.statusText;

        const progressContainer = el.querySelector('[data-download-role="progress"]');
        if (renderState.showProgress !== Boolean(progressContainer)) return false;

        if (progressContainer) {
            const progressFill = progressContainer.querySelector('[data-download-role="progress-fill"]');
            if (!progressFill) return false;

            if (item.state === 'waiting_for_save') {
                if (!progressFill.classList.contains('download-progress-indeterminate')) {
                    progressFill.classList.add('download-progress-indeterminate');
                    ensureDownloadAnimationStyles();
                    progressFill.style.cssText = 'width:30%; height:100%; background:var(--theme-accent, var(--accent-primary, #8ab4f8)); position:absolute; left:0; animation: braveIndeterminate 1.5s infinite ease-in-out; border-radius:2px; will-change:transform;';
                }
            } else {
                progressFill.classList.remove('download-progress-indeterminate');
                progressFill.style.width = `${renderState.progressPercent}%`;
            }
        }

        return true;
    }

    function createItemElement(item, isPopup = false) {
        const el = document.createElement('div');
        el.className = 'download-item';
        el.dataset.downloadId = item.id || '';

        const renderState = getItemRenderState(item);
        applyItemStateClasses(el, renderState.stateClass);

        const infoDiv = document.createElement('div');
        infoDiv.className = 'download-item-info';
        
        const nameDiv = document.createElement('div');
        nameDiv.className = 'download-item-filename';
        nameDiv.dataset.downloadRole = 'filename';
        nameDiv.textContent = item.fileName || 'İndirme';
        infoDiv.appendChild(nameDiv);

        const statusDiv = document.createElement('div');
        statusDiv.className = 'download-item-status';
        statusDiv.dataset.downloadRole = 'status';
        statusDiv.textContent = renderState.statusText;
        infoDiv.appendChild(statusDiv);

        if (renderState.showProgress) {
            const progressContainer = document.createElement('div');
            progressContainer.className = 'download-item-progress-bar';
            progressContainer.dataset.downloadRole = 'progress';
            progressContainer.style.position = 'relative';
            progressContainer.style.overflow = 'hidden';
            const progressFill = document.createElement('div');
            progressFill.className = 'download-item-progress-fill';
            progressFill.dataset.downloadRole = 'progress-fill';
            if (item.state === 'waiting_for_save') {
                progressFill.classList.add('download-progress-indeterminate');
                ensureDownloadAnimationStyles();
                const animDelay = (Date.now() % 1500) / 1000;
                progressFill.style.cssText = `width:30%; height:100%; background:var(--theme-accent, var(--accent-primary, #8ab4f8)); position:absolute; left:0; animation: braveIndeterminate 1.5s infinite ease-in-out; animation-delay: -${animDelay}s; border-radius:2px; will-change:transform;`;
            } else {
                progressFill.style.width = `${renderState.progressPercent}%`;
            }
            progressContainer.appendChild(progressFill);
            infoDiv.appendChild(progressContainer);
        }

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'download-item-actions';

        api.checkExists(item.savePath).then(exists => {
            if (item.state === 'completed') {
                if (!exists) {
                    statusDiv.textContent = 'Silindi';
                    statusDiv.classList.add('deleted');
                } else {
                    const folderBtn = document.createElement('button');
                    folderBtn.className = 'download-item-btn';
                    folderBtn.title = 'Klasörde göster';
                    folderBtn.innerHTML = '<span class="material-symbols-rounded">folder_open</span>';
                    folderBtn.onclick = (e) => {
                        e.stopPropagation();
                        api.showInFolder(item.savePath);
                    };
                    actionsDiv.appendChild(folderBtn);
                }
            }
        });

        // Add pause/resume and cancel buttons if active
        if (item.state === 'downloading' || item.state === 'paused') {
            const pauseBtn = document.createElement('button');
            pauseBtn.className = 'download-item-btn';
            pauseBtn.title = item.state === 'paused' ? 'Devam ettir' : 'Duraklat';
            pauseBtn.innerHTML = item.state === 'paused' ? '<span class="material-symbols-rounded">play_arrow</span>' : '<span class="material-symbols-rounded">pause</span>';
            pauseBtn.onclick = (e) => {
                e.stopPropagation();
                if (item.state === 'paused') {
                    api.resume(item.id);
                } else {
                    api.pause(item.id);
                }
            };
            actionsDiv.appendChild(pauseBtn);

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'download-item-btn';
            cancelBtn.title = 'İptal et';
            cancelBtn.innerHTML = '<span class="material-symbols-rounded">stop</span>';
            cancelBtn.onclick = (e) => {
                e.stopPropagation();
                api.cancel(item.id);
            };
            actionsDiv.appendChild(cancelBtn);
        }

        // Delete button
        const removeBtn = document.createElement('button');
        removeBtn.className = 'download-item-btn';
        removeBtn.title = 'Listeden kaldır';
        removeBtn.innerHTML = '<span class="material-symbols-rounded">close</span>';
        removeBtn.onclick = async (e) => {
            e.stopPropagation();
            await api.removeItem(item.id);
            loadHistory();
        };
        actionsDiv.appendChild(removeBtn);

        const iconDiv = document.createElement('div');
        iconDiv.className = 'download-item-icon';
        iconDiv.dataset.downloadRole = 'icon';
        iconDiv.innerHTML = `<span class="material-symbols-rounded">${renderState.icon}</span>`;

        el.appendChild(iconDiv);
        el.appendChild(infoDiv);
        el.appendChild(actionsDiv);

        // Click to open file if completed and exists
        el.onclick = async () => {
            if (item.state === 'completed') {
                const exists = await api.checkExists(item.savePath);
                if (exists) {
                    api.showInFolder(item.savePath); // Fallback behavior
                }
            }
        };

        return el;
    }

    function playDownloadAnimation(onComplete) {
        ensureDownloadAnimationStyles();

        const buttonRect = btnDownloads ? btnDownloads.getBoundingClientRect() : null;

        const targetX = buttonRect ? buttonRect.left + buttonRect.width / 2 : window.innerWidth - 60;
        const targetY = buttonRect ? buttonRect.top + buttonRect.height / 2 : 34;
        const startX = Math.max(80, Math.min(window.innerWidth - 80, targetX + 8));
        const startY = Math.max(targetY + 160, Math.min(window.innerHeight - 116, targetY + 320));

        const iconContainer = document.createElement('div');
        iconContainer.className = 'brave-download-flyer';
        iconContainer.style.left = `${startX}px`;
        iconContainer.style.top = `${startY}px`;
        
        const icon = document.createElement('span');
        icon.className = 'material-symbols-rounded';
        icon.textContent = 'download';
        
        iconContainer.appendChild(icon);
        document.body.appendChild(iconContainer);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                iconContainer.style.opacity = '1';
                iconContainer.style.transform = 'translate(-50%, -50%) scale(1)';

                setTimeout(() => {
                    iconContainer.style.left = targetX + 'px';
                    iconContainer.style.top = targetY + 'px';
                    iconContainer.style.transform = 'translate(-50%, -50%) scale(0.42)';
                    
                    setTimeout(() => {
                        const pulseTarget = btnDownloads;
                        if (pulseTarget) {
                            pulseTarget.classList.remove('brave-download-target-pulse');
                            void pulseTarget.offsetWidth;
                            pulseTarget.classList.add('brave-download-target-pulse');
                            setTimeout(() => pulseTarget.classList.remove('brave-download-target-pulse'), 650);
                        }
                        iconContainer.style.transition = 'opacity 180ms ease, transform 180ms cubic-bezier(0.16, 1, 0.3, 1)';
                        iconContainer.style.transform = 'translate(-50%, -50%) scale(0.16)';
                        iconContainer.style.opacity = '0';
                        setTimeout(() => {
                            if (iconContainer.parentNode) iconContainer.parentNode.removeChild(iconContainer);
                            if (typeof onComplete === 'function') {
                                onComplete();
                            }
                        }, 190);
                    }, 1080);
                }, 170);
            });
        });
    }

    function createBraveActiveItem(item) {
        ensureDownloadAnimationStyles();

        const el = document.createElement('div');
        el.className = 'brave-download-item';
        
        const isWaiting = item.state === 'waiting_for_save';
        const header = document.createElement('div');
        header.className = 'brave-header';
        
        const etaText = isWaiting ? 'Bekleniyor...' : (item.state === 'paused' ? 'Duraklatıldı' : formatEta(item._eta));
        window.ardaliSetHTML(header, `
            <div style="display:flex; align-items:center; gap:8px;">
                <span class="material-symbols-rounded" style="color:var(--accent-primary);font-size:18px;">cloud_download</span>
                <span style="font-weight:600; color:var(--text-primary);">ArDali</span>
            </div>
            <div style="color:var(--text-secondary); font-size:13px; display:flex; align-items:center; gap:4px;">
                ${etaText}
                <span class="material-symbols-rounded" style="font-size:18px;">expand_more</span>
            </div>
        `);
        
        const title = document.createElement('div');
        title.style.cssText = "font-size:16px; font-weight:bold; margin-top:12px; color:var(--text-primary);";
        title.textContent = isWaiting ? 'Kaydetme bekleniyor' : (item.state === 'paused' ? 'Duraklatıldı' : 'İndiriliyor');
        
        const fileInfo = document.createElement('div');
        fileInfo.style.cssText = "font-size:13px; color:var(--text-secondary); margin-top:4px; line-height:1.4;";
        const fileNameSpan = document.createElement('span');
        fileNameSpan.style.color = 'var(--text-primary)';
        fileNameSpan.textContent = item.fileName || 'İndirme';
        const downloadsLink = document.createElement('span');
        downloadsLink.style.cssText = 'color:var(--accent-primary); cursor:pointer;';
        downloadsLink.textContent = 'İndirilenler';
        downloadsLink.title = 'İndirilenler klasörünü aç';
        downloadsLink.onclick = (e) => {
            e.stopPropagation();
            api.openDownloadsFolder();
        };
        fileInfo.appendChild(fileNameSpan);
        fileInfo.appendChild(document.createTextNode(', '));
        fileInfo.appendChild(downloadsLink);
        fileInfo.appendChild(document.createTextNode(' konumuna'));
        
        const progressPercent = item.totalBytes > 0 ? (item.receivedBytes / item.totalBytes) * 100 : 0;
        const progressContainer = document.createElement('div');
        progressContainer.style.cssText = "width:100%; height:4px; background:var(--bg-tertiary); border-radius:2px; margin-top:12px; overflow:hidden; position:relative;";
        const progressFill = document.createElement('div');
        if (isWaiting) {
            progressFill.className = 'download-progress-indeterminate';
            const animDelay = (Date.now() % 1500) / 1000;
            progressFill.style.cssText = `width:30%; height:100%; background:var(--theme-accent, var(--accent-primary, #8ab4f8)); position:absolute; left:0; animation: braveIndeterminate 1.5s infinite ease-in-out; animation-delay: -${animDelay}s; border-radius:2px; will-change:transform;`;
        } else {
            progressFill.style.cssText = `width:${progressPercent}%; height:100%; background:var(--accent-primary); transition:width 0.3s; border-radius:2px;`;
        }
        progressContainer.appendChild(progressFill);
        
        const percentText = document.createElement('div');
        percentText.style.cssText = "font-size:12px; color:var(--text-secondary); text-align:right; margin-top:4px; min-height:14px;";
        percentText.textContent = isWaiting ? '' : `%${Math.round(progressPercent)}`;
        
        const buttonsRow = document.createElement('div');
        buttonsRow.style.cssText = "display:flex; justify-content:space-between; align-items:center; margin-top:12px;";
        
        const detailsBtn = document.createElement('button');
        detailsBtn.className = 'download-item-btn';
        detailsBtn.style.cssText = "padding: 6px 12px; border-radius: 4px; font-size: 13px; border: 1px solid var(--border-color); background: transparent; display:flex; align-items:center; gap:4px; width: auto; height: auto;";
        detailsBtn.innerHTML = `<span class="material-symbols-rounded" style="font-size:16px;">expand_more</span> Ayrıntılar`;
        
        const actionsBox = document.createElement('div');
        actionsBox.style.cssText = "display:flex; gap:8px;";
        
        const pauseBtn = document.createElement('button');
        pauseBtn.className = 'download-item-btn';
        pauseBtn.style.cssText = "padding: 6px 12px; border-radius: 4px; font-size: 13px; border: 1px solid var(--border-color); background: transparent; display:flex; align-items:center; gap:4px; width: auto; height: auto;";
        pauseBtn.innerHTML = `<span class="material-symbols-rounded" style="font-size:16px;">${item.state === 'paused' ? 'play_arrow' : 'pause'}</span> ${item.state === 'paused' ? 'Devam et' : 'Duraklat'}`;
        if (isWaiting) pauseBtn.disabled = true;
        pauseBtn.onclick = () => {
            if (isWaiting) return;
            if (item.state === 'paused') api.resume(item.id);
            else api.pause(item.id);
        };
        
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'download-item-btn';
        cancelBtn.style.cssText = "padding: 6px 12px; border-radius: 4px; font-size: 13px; border: 1px solid var(--border-color); background: transparent; display:flex; align-items:center; gap:4px; width: auto; height: auto;";
        cancelBtn.innerHTML = `<span class="material-symbols-rounded" style="font-size:16px;">block</span> İptal`;
        cancelBtn.onclick = () => {
            api.cancel(item.id);
        };
        
        actionsBox.appendChild(pauseBtn);
        actionsBox.appendChild(cancelBtn);
        
        buttonsRow.appendChild(detailsBtn);
        buttonsRow.appendChild(actionsBox);
        
        const detailsPanel = document.createElement('div');
        if (!isBraveDetailsExpanded) {
            detailsPanel.className = 'hidden';
            detailsBtn.innerHTML = `<span class="material-symbols-rounded" style="font-size:16px;">expand_more</span> Ayrıntılar`;
        } else {
            detailsPanel.className = '';
            detailsBtn.innerHTML = `<span class="material-symbols-rounded" style="font-size:16px;">expand_less</span> Ayrıntılar`;
        }
        detailsPanel.style.cssText = "margin-top:12px; padding-top:12px; font-size:12px; color:var(--text-secondary);";
        
        const speed = isWaiting ? 0 : (item._speed || 0);
        const avgSpeed = isWaiting ? 0 : (item._avgSpeed || 0);
        const sizeText = isWaiting ? 'Hesaplanıyor...' : `${formatBytes(item.receivedBytes)} / ${formatBytes(item.totalBytes)}`;
        
        window.ardaliSetHTML(detailsPanel, `
            <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
                <div>Hız <span style="color:var(--text-primary);">${formatBytes(speed)}/sn</span></div>
                <div>Ortalama Hız <span style="color:var(--text-primary);">${formatBytes(avgSpeed)}/sn</span></div>
            </div>
            <div style="display:grid; grid-template-columns: 50px 1fr; gap:8px; line-height:1.4;">
                <div>Kaynak:</div><div style="word-break:break-all;color:var(--text-primary);">${item.url}</div>
                <div>Hedef:</div><div style="word-break:break-all;color:var(--text-primary);">${isWaiting ? 'Seçilmesi bekleniyor' : item.savePath}</div>
                <div>Boyut:</div><div style="color:var(--text-primary);">${sizeText}</div>
            </div>
        `);
        
        detailsBtn.onclick = () => {
            isBraveDetailsExpanded = !isBraveDetailsExpanded;
            if (isBraveDetailsExpanded) {
                detailsPanel.classList.remove('hidden');
                const icon = detailsBtn.querySelector('.material-symbols-rounded');
                if (icon) icon.textContent = 'expand_less';
            } else {
                detailsPanel.classList.add('hidden');
                const icon = detailsBtn.querySelector('.material-symbols-rounded');
                if (icon) icon.textContent = 'expand_more';
            }
        };
        
        el.appendChild(header);
        el.appendChild(title);
        el.appendChild(fileInfo);
        el.appendChild(progressContainer);
        el.appendChild(percentText);
        el.appendChild(detailsPanel);
        el.appendChild(buttonsRow);
        
        return el;
    }

    async function renderPopup() {
        popupList.innerHTML = '';
        if (downloadsHistory.length === 0) {
            popupList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--theme-text-muted);">İndirme geçmişi boş.</div>';
            return;
        }

        const activeItem = downloadsHistory.find(d => isActiveDownloadState(d.state));
        
        if (activeItem) {
            popupList.appendChild(createBraveActiveItem(activeItem));
        } else {
            const recent = downloadsHistory.slice(0, 5);
            for (const item of recent) {
                popupList.appendChild(createItemElement(item, true));
            }
        }
    }

    async function renderPage() {
        if (downloadsHistory.length === 0) {
            if (downloadsPageSignature !== 'empty') {
                downloadsPageSignature = 'empty';
                pageContent.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--theme-text-muted); font-size: 16px;">İndirme bulunamadı.</div>';
            }
            return;
        }

        // Group by date
        const groups = {};
        for (const item of downloadsHistory) {
            const dateLabel = formatDate(item.startTime);
            if (!groups[dateLabel]) groups[dateLabel] = [];
            groups[dateLabel].push(item);
        }

        const nextSignature = getPageSignature(groups);
        if (downloadsPageSignature === nextSignature) {
            for (const item of downloadsHistory) {
                const existingItem = Array.from(pageContent.querySelectorAll('.download-item[data-download-id]'))
                    .find(el => el.dataset.downloadId === String(item.id || ''));
                if (!existingItem || !updateItemElement(existingItem, item)) {
                    downloadsPageSignature = '';
                    renderPage();
                    return;
                }
            }
            return;
        }

        downloadsPageSignature = nextSignature;
        pageContent.innerHTML = '';
        for (const [dateLabel, items] of Object.entries(groups)) {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'download-date-group';

            const headerDiv = document.createElement('div');
            headerDiv.className = 'download-date-header';
            headerDiv.textContent = dateLabel;
            groupDiv.appendChild(headerDiv);

            const listContainer = document.createElement('div');
            listContainer.className = 'download-list-container';

            for (const item of items) {
                listContainer.appendChild(createItemElement(item, false));
            }

            groupDiv.appendChild(listContainer);
            pageContent.appendChild(groupDiv);
        }
    }

    // --- Event Listeners ---
    if (btnDownloads) {
        btnDownloads.addEventListener('click', (e) => {
            e.stopPropagation();
            isPopupOpen = !isPopupOpen;
            if (isPopupOpen) {
                popup.classList.remove('hidden');
                btnDownloads.classList.add('active');
                loadHistory();
            } else {
                closeDownloadsPopup();
            }
        });
    }

    window.addEventListener('ardali:tab-url-changed', (e) => {
        const url = e.detail;
        if (url === 'ardali://downloads') {
            if (isPopupOpen) closeDownloadsPopup();
            loadHistory();
        } else {
            const hasActiveDownload = downloadsHistory.some(d => isActiveDownloadState(d.state));
            if (hasActiveDownload && !isPopupOpen) {
                openDownloadsPopup();
            }
        }
    });

    document.addEventListener('click', (e) => {
        if (isPopupOpen && !popup.contains(e.target) && !btnDownloads.contains(e.target)) {
            closeDownloadsPopup();
        }
    });

    window.addEventListener('ardali:webview-pointer-down', () => {
        if (isPopupOpen) closeDownloadsPopup();
    });

    if (popupShowAllBtn) {
        popupShowAllBtn.addEventListener('click', () => {
            closeDownloadsPopup();
            
            if (window.createTab) {
                window.createTab('ardali://downloads');
            }
        });
    }

    if (popupClearBtn) {
        popupClearBtn.addEventListener('click', async () => {
            await api.clearHistory();
            loadHistory();
        });
    }

    if (pageCloseBtn) {
        pageCloseBtn.addEventListener('click', () => {
            downloadsPage.classList.add('hidden');
        });
    }

    if (pageClearAllBtn) {
        pageClearAllBtn.addEventListener('click', async () => {
            await api.clearHistory();
            loadHistory();
        });
    }

    // --- IPC Updates ---
    api.onProgress((data) => {
        const now = Date.now();
        // Update item in local array if exists
        let shouldRender = true;
        const idx = downloadsHistory.findIndex(d => d.id === data.id);
        
        if (idx !== -1) {
            const oldItem = downloadsHistory[idx];
            if (oldItem.state === 'waiting_for_save' && data.state === 'waiting_for_save') {
                shouldRender = false;
            }
            if (oldItem._lastTime) {
                const timeDiff = (now - oldItem._lastTime) / 1000;
                const bytesDiff = data.receivedBytes - oldItem.receivedBytes;
                if (timeDiff > 0 && bytesDiff > 0) {
                    data._speed = bytesDiff / timeDiff;
                    data._speeds = oldItem._speeds || [];
                    data._speeds.push(data._speed);
                    if (data._speeds.length > 30) data._speeds.shift();
                    data._avgSpeed = data._speeds.reduce((a,b)=>a+b, 0) / data._speeds.length;
                    const remaining = data.totalBytes - data.receivedBytes;
                    if (data._avgSpeed > 0) data._eta = remaining / data._avgSpeed;
                } else {
                    data._speed = oldItem._speed || 0;
                    data._speeds = oldItem._speeds || [];
                    data._avgSpeed = oldItem._avgSpeed || 0;
                    data._eta = oldItem._eta || 0;
                }
            }
            data._lastTime = now;
            downloadsHistory[idx] = data;
            
            if (data.state === 'waiting_for_save') {
                openDownloadsPopup();
            } else if (!animatedDownloads.has(data.id)) {
                animatedDownloads.add(data.id);
                if (isPopupOpen) closeDownloadsPopup();
                playDownloadAnimation(() => openDownloadsPopup());
            }
        } else {
            data._lastTime = now;
            downloadsHistory.unshift(data);
            
            if (data.state === 'waiting_for_save') {
                openDownloadsPopup();
            } else if (!animatedDownloads.has(data.id)) {
                animatedDownloads.add(data.id);
                if (isPopupOpen) closeDownloadsPopup();
                playDownloadAnimation(() => openDownloadsPopup());
            }
        }
        
        if (shouldRender) {
            if (isPopupOpen) renderPopup();
            if (isPageOpen()) renderPage();
        }
        updateGlobalProgressRing();
    });

    api.onDone((data) => {
        const idx = downloadsHistory.findIndex(d => d.id === data.id);
        if (idx !== -1) {
            downloadsHistory[idx] = data;
        } else {
            downloadsHistory.unshift(data);
        }
        
        if (isPopupOpen) renderPopup();
        if (isPageOpen()) renderPage();
        updateGlobalProgressRing();
    });

    // Initial Load
    loadHistory();
});
