import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

app.registerExtension({
    name: "OreX.AudioLoad",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "orex Audio load") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                
                // Получаем все 4 виджета
                const fileWidget = this.widgets.find(w => w.name === "audio");
                const startWidget = this.widgets.find(w => w.name === "trim_start_sec");
                const startExactWidget = this.widgets.find(w => w.name === "trim_start");
                const endWidget = this.widgets.find(w => w.name === "trim_end_sec");
                const endExactWidget = this.widgets.find(w => w.name === "trim_end");

                let audioDuration = 0;
                const hiddenAudio = document.createElement("audio");
                hiddenAudio.style.display = "none";

                // === КАСТОМНАЯ ОТРИСОВКА ===
                if (endWidget) {
                    endWidget.draw = function(ctx, node, widget_width, y, widget_height) {
                        const margin = 15;
                        const inner_width = widget_width - margin * 2;
                        
                        ctx.fillStyle = "#222"; 
                        ctx.fillRect(margin, y, inner_width, widget_height);
                        
                        let range = this.options.max - this.options.min;
                        let v = range === 0 ? 0 : (this.value - this.options.min) / range;
                        v = Math.max(0, Math.min(1, v)); 
                        
                        let bar_width = v * inner_width;
                        
                        ctx.fillStyle = "#637788"; 
                        ctx.fillRect(margin + inner_width - bar_width, y, bar_width, widget_height);

                        ctx.fillStyle = "#fff";
                        ctx.textAlign = "center";
                        ctx.font = "12px sans-serif";
                        ctx.fillText(`${this.name} ${this.value.toFixed(2)}`, widget_width * 0.5, y + widget_height * 0.7);
                    };

                    endWidget.mouse = function(e, pos, node) {
                        if (e.type === "pointerdown" || e.type === "mousedown" || e.type === "pointermove" || e.type === "mousemove") {
                            const margin = 15;
                            const inner_width = node.size[0] - margin * 2;
                            let x = pos[0] - margin;
                            
                            let percent = 1.0 - (x / inner_width);
                            percent = Math.max(0, Math.min(1, percent));
                            
                            let range = this.options.max - this.options.min;
                            let val = this.options.min + percent * range;
                            
                            if (this.options.step) {
                                val = Math.round(val / this.options.step) * this.options.step;
                            }
                            
                            if (this.value !== val) {
                                this.value = val;
                                if (this.callback) this.callback(this.value, app.canvas, node, pos, e);
                                app.graph.setDirtyCanvas(true, true);
                            }
                        }
                        return true; 
                    };
                }

                // === БЛОК ЗАГРУЗКИ ФАЙЛА (DRAG & DROP) ===
                const uploadContainer = document.createElement("div");
                uploadContainer.style.border = "2px dashed transparent";
                uploadContainer.style.borderRadius = "6px";
                uploadContainer.style.padding = "2px";
                uploadContainer.style.transition = "border-color 0.2s ease";
                uploadContainer.style.marginTop = "6px"; 
                uploadContainer.style.marginBottom = "6px";

                const uploadBtn = document.createElement("button");
                uploadBtn.textContent = "choose file to upload (or drag & drop)";
                uploadBtn.style.width = "100%";
                uploadBtn.style.padding = "4px";
                uploadBtn.style.cursor = "pointer";
                uploadBtn.style.backgroundColor = "#333";
                uploadBtn.style.color = "#ccc";
                uploadBtn.style.border = "1px solid #555";
                uploadBtn.style.borderRadius = "4px";

                const fileInput = document.createElement("input");
                fileInput.type = "file";
                fileInput.accept = "audio/*,video/*";
                fileInput.style.display = "none";
                uploadBtn.onclick = () => fileInput.click();

                const handleFileUpload = async (file) => {
                    const CHUNK_SIZE = 5 * 1024 * 1024; 
                    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
                    const filename = file.name;

                    try {
                        uploadBtn.style.backgroundColor = "#444";
                        
                        for (let i = 0; i < totalChunks; i++) {
                            const start = i * CHUNK_SIZE;
                            const end = Math.min(start + CHUNK_SIZE, file.size);
                            const chunk = file.slice(start, end);
                            
                            const body = new FormData();
                            body.append("file", chunk);
                            body.append("filename", filename);
                            body.append("chunk_index", i);
                            body.append("total_chunks", totalChunks);

                            const resp = await api.fetchApi("/orex/upload_chunk", { method: "POST", body: body });
                            
                            if (!resp.ok) {
                                const errText = await resp.text();
                                throw new Error(`Server rejected chunk ${i + 1}: ${errText}`);
                            }

                            const data = await resp.json();
                            const progress = Math.round(((i + 1) / totalChunks) * 100);
                            uploadBtn.textContent = `Uploading... ${progress}%`;

                            // Если это последний кусок и сервер вернул финальный путь
                            if (i === totalChunks - 1 && data.full_path) {
                                // Теперь fileWidget - это STRING поле, просто пишем в него полный путь
                                fileWidget.value = data.full_path;
                                fileWidget.callback();
                            }
                        }

                    } catch (error) {
                        console.error("[OreX.AudioLoad] Media upload failed:", error);
                        uploadBtn.textContent = "Upload Error! See F12";
                        uploadBtn.style.backgroundColor = "#8b0000"; 
                    } finally {
                        setTimeout(() => {
                            uploadBtn.textContent = "choose file to upload (or drag & drop)";
                            uploadBtn.style.backgroundColor = "#333";
                        }, 3000);
                    }
                };

                fileInput.onchange = () => { if (fileInput.files.length) handleFileUpload(fileInput.files[0]); };

                uploadContainer.addEventListener("dragover", (e) => { e.preventDefault(); uploadContainer.style.borderColor = "#4CC9F0"; });
                uploadContainer.addEventListener("dragleave", (e) => { e.preventDefault(); uploadContainer.style.borderColor = "transparent"; });
                uploadContainer.addEventListener("drop", (e) => {
                    e.preventDefault();
                    uploadContainer.style.borderColor = "transparent";
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files[0]);
                });

                uploadContainer.appendChild(uploadBtn);
                uploadContainer.appendChild(fileInput);

                // === БЛОК ПЛЕЕРА ===
                const playerContainer = document.createElement("div");
                playerContainer.style.display = "flex";
                playerContainer.style.alignItems = "center";
                playerContainer.style.gap = "8px";
                playerContainer.style.padding = "6px 10px";
                playerContainer.style.backgroundColor = "rgba(0,0,0,0.4)";
                playerContainer.style.borderRadius = "4px";
                playerContainer.style.color = "#ccc";
                playerContainer.style.fontFamily = "sans-serif";
                playerContainer.style.fontSize = "12px";
                playerContainer.style.marginTop = "4px";

                const playBtn = document.createElement("button");
                playBtn.innerHTML = "▶";
                playBtn.style.background = "none";
                playBtn.style.border = "none";
                playBtn.style.color = "#fff";
                playBtn.style.cursor = "pointer";
                playBtn.style.fontSize = "16px";
                playBtn.style.padding = "0";

                const timeDisplay = document.createElement("span");
                timeDisplay.innerText = "0:00 / 0:00";
                timeDisplay.style.minWidth = "70px";
                timeDisplay.style.textAlign = "center";

                const seekBar = document.createElement("input");
                seekBar.type = "range";
                seekBar.min = 0;
                seekBar.max = 100;
                seekBar.value = 0;
                seekBar.style.flexGrow = "1";
                seekBar.style.cursor = "pointer";

                playerContainer.appendChild(playBtn);
                playerContainer.appendChild(timeDisplay);
                playerContainer.appendChild(seekBar);
                playerContainer.appendChild(hiddenAudio);

                const domWidgetUpload = this.addDOMWidget("upload_container", "div", uploadContainer, { serialize: false, hideOnZoom: false });
                const domWidgetPlayer = this.addDOMWidget("player_container", "div", playerContainer, { serialize: false, hideOnZoom: false });
                
                domWidgetUpload.computeSize = function() { return [200, 40]; };
                domWidgetPlayer.computeSize = function() { return [200, 45]; };

                const formatTime = (sec) => {
                    const m = Math.floor(sec / 60);
                    const s = Math.floor(sec % 60).toString().padStart(2, '0');
                    return `${m}:${s}`;
                };

                const getTrimmedBounds = () => {
                    const start = startExactWidget ? parseFloat(startExactWidget.value) : 0;
                    const endCut = endExactWidget ? parseFloat(endExactWidget.value) : 0;
                    const end = audioDuration - endCut;
                    const safeStart = Math.max(0, Math.min(start, audioDuration));
                    const safeEnd = Math.max(safeStart + 0.1, Math.min(end, audioDuration));
                    return { start: safeStart, end: safeEnd, duration: safeEnd - safeStart };
                };

                const updateDisplayFromSliders = () => {
                    if(!hiddenAudio.paused) {
                         hiddenAudio.pause();
                         playBtn.innerHTML = "▶";
                    }
                    const bounds = getTrimmedBounds();
                    timeDisplay.innerText = `0:00 / ${formatTime(bounds.duration)}`;
                    hiddenAudio.currentTime = bounds.start;
                    seekBar.value = 0;
                };

                const updateAudioSrc = () => {
                    if (fileWidget && fileWidget.value) {
                        const fullPath = fileWidget.value;
                        // Браузер не даст плееру играть напрямую файл с диска (ограничения безопасности).
                        // Поэтому мы "откусываем" только имя файла из пути.
                        const filename = fullPath.split(/[/\\]/).pop();
                        
                        if (filename) {
                            hiddenAudio.src = api.apiURL(`/view?filename=${encodeURIComponent(filename)}&type=input`);
                        }
                    }
                };

                let isConfiguring = false;
                const origConfigure = this.onConfigure;
                this.onConfigure = function(info) {
                    isConfiguring = true; 
                    if (origConfigure) origConfigure.apply(this, arguments);
                    if (fileWidget && fileWidget.value) {
                        lastFile = fileWidget.value;
                        updateAudioSrc(); 
                    }
                    isConfiguring = false;
                };

                let lastFile = fileWidget ? fileWidget.value : null;

                if (fileWidget) {
                    const originalCallback = fileWidget.callback;
                    fileWidget.callback = function() {
                        if (!isConfiguring && lastFile !== this.value) {
                            if (startWidget) startWidget.value = 0;
                            if (startExactWidget) startExactWidget.value = 0;
                            if (endWidget) endWidget.value = 0;
                            if (endExactWidget) endExactWidget.value = 0;
                            updateDisplayFromSliders();
                        }
                        lastFile = this.value;
                        updateAudioSrc();
                        if (originalCallback) originalCallback.apply(this, arguments);
                    };
                    updateAudioSrc();
                }

                hiddenAudio.addEventListener("loadedmetadata", () => {
                    audioDuration = hiddenAudio.duration;
                    if (startWidget) startWidget.options.max = audioDuration;
                    if (startExactWidget) startExactWidget.options.max = audioDuration;
                    if (endWidget) endWidget.options.max = audioDuration;
                    if (endExactWidget) endExactWidget.options.max = audioDuration;
                    
                    const bounds = getTrimmedBounds();
                    timeDisplay.innerText = `0:00 / ${formatTime(bounds.duration)}`;
                    hiddenAudio.currentTime = bounds.start;
                });

                playBtn.onclick = () => {
                    if (hiddenAudio.paused) {
                        const bounds = getTrimmedBounds();
                        if (hiddenAudio.currentTime >= bounds.end || hiddenAudio.currentTime < bounds.start) {
                            hiddenAudio.currentTime = bounds.start;
                        }
                        hiddenAudio.play();
                        playBtn.innerHTML = "⏸";
                    } else {
                        hiddenAudio.pause();
                        playBtn.innerHTML = "▶";
                    }
                };

                hiddenAudio.addEventListener("timeupdate", () => {
                    const bounds = getTrimmedBounds();
                    if (hiddenAudio.currentTime >= bounds.end) {
                        hiddenAudio.pause();
                        hiddenAudio.currentTime = bounds.start;
                        playBtn.innerHTML = "▶";
                    }
                    const currentRel = Math.max(0, hiddenAudio.currentTime - bounds.start);
                    const progress = (currentRel / bounds.duration) * 100;
                    seekBar.value = isNaN(progress) ? 0 : progress;
                    timeDisplay.innerText = `${formatTime(currentRel)} / ${formatTime(bounds.duration)}`;
                });

                hiddenAudio.addEventListener("ended", () => { playBtn.innerHTML = "▶"; });

                seekBar.addEventListener("input", (e) => {
                    const bounds = getTrimmedBounds();
                    hiddenAudio.currentTime = bounds.start + (e.target.value / 100) * bounds.duration;
                });

                // === СИСТЕМА ДВУСТОРОННЕЙ СИНХРОНИЗАЦИИ ===
                let isSyncing = false;

                if (startWidget && startExactWidget) {
                    const origStartCb = startWidget.callback;
                    startWidget.callback = function() {
                        if (!isSyncing) {
                            isSyncing = true;
                            startExactWidget.value = parseFloat(this.value.toFixed(2));
                            isSyncing = false;
                        }
                        updateDisplayFromSliders();
                        if (origStartCb) origStartCb.apply(this, arguments);
                    };

                    const origStartExactCb = startExactWidget.callback;
                    startExactWidget.callback = function() {
                        if (!isSyncing) {
                            isSyncing = true;
                            startWidget.value = parseFloat(this.value.toFixed(2));
                            isSyncing = false;
                        }
                        updateDisplayFromSliders();
                        if (origStartExactCb) origStartExactCb.apply(this, arguments);
                    };
                }

                if (endWidget && endExactWidget) {
                    const origEndCb = endWidget.callback;
                    endWidget.callback = function() {
                        if (!isSyncing) {
                            isSyncing = true;
                            endExactWidget.value = parseFloat(this.value.toFixed(2));
                            isSyncing = false;
                        }
                        updateDisplayFromSliders();
                        if (origEndCb) origEndCb.apply(this, arguments);
                    };

                    const origEndExactCb = endExactWidget.callback;
                    endExactWidget.callback = function() {
                        if (!isSyncing) {
                            isSyncing = true;
                            endWidget.value = parseFloat(this.value.toFixed(2));
                            isSyncing = false;
                        }
                        updateDisplayFromSliders();
                        if (origEndExactCb) origEndExactCb.apply(this, arguments);
                    };
                }

                this.size = [360, 320];
                return r;
            };
        }
    }
});