import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

app.registerExtension({
    name: "OreX.AdvancedVideoLoad",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "OreX_AdvancedVideoLoad") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                
                const fileWidget = this.widgets.find(w => w.name === "video_path");

                // === 1. БЛОК ЗАГРУЗКИ (Drag & Drop) ===
                const uploadContainer = document.createElement("div");
                uploadContainer.style.border = "2px dashed #444";
                uploadContainer.style.borderRadius = "6px";
                uploadContainer.style.padding = "4px";
                uploadContainer.style.textAlign = "center";
                uploadContainer.style.marginTop = "8px";

                const uploadBtn = document.createElement("button");
                uploadBtn.textContent = "Drop Large Video or Click";
                uploadBtn.style.width = "100%";
                uploadBtn.style.padding = "6px";
                uploadBtn.style.cursor = "pointer";
                uploadBtn.style.backgroundColor = "#222";
                uploadBtn.style.color = "#ddd";
                uploadBtn.style.border = "none";

                const fileInput = document.createElement("input");
                fileInput.type = "file";
                fileInput.accept = "video/*";
                fileInput.style.display = "none";
                uploadBtn.onclick = () => fileInput.click();

                const handleFileUpload = async (file) => {
                    // Используем чанковую загрузку из OreX_AudioLoad
                    const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB для видео
                    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
                    
                    try {
                        uploadBtn.style.backgroundColor = "#555";
                        for (let i = 0; i < totalChunks; i++) {
                            const chunk = file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size));
                            const body = new FormData();
                            body.append("file", chunk);
                            body.append("filename", file.name);
                            body.append("chunk_index", i);
                            body.append("total_chunks", totalChunks);

                            const resp = await api.fetchApi("/orex/upload_chunk", { method: "POST", body: body });
                            if (!resp.ok) throw new Error("Upload failed");

                            const data = await resp.json();
                            uploadBtn.textContent = `Uploading... ${Math.round(((i + 1) / totalChunks) * 100)}%`;

                            if (i === totalChunks - 1 && data.full_path) {
                                fileWidget.value = data.full_path;
                                updatePlayer(data.name, "input");
                            }
                        }
                    } catch (error) {
                        console.error("[OreX] Video upload error:", error);
                        uploadBtn.textContent = "Upload Failed";
                    } finally {
                        setTimeout(() => uploadBtn.textContent = "Drop Large Video or Click", 2000);
                    }
                };

                fileInput.onchange = () => { if (fileInput.files.length) handleFileUpload(fileInput.files[0]); };
                uploadContainer.ondragover = (e) => { e.preventDefault(); uploadContainer.style.borderColor = "#4CC9F0"; };
                uploadContainer.ondragleave = (e) => { e.preventDefault(); uploadContainer.style.borderColor = "#444"; };
                uploadContainer.ondrop = (e) => {
                    e.preventDefault();
                    uploadContainer.style.borderColor = "#444";
                    if (e.dataTransfer.files.length) handleFileUpload(e.dataTransfer.files[0]);
                };

                uploadContainer.appendChild(uploadBtn);
                uploadContainer.appendChild(fileInput);

                // === 2. БЛОК ВИДЕОПЛЕЕРА ===
                const videoContainer = document.createElement("div");
                videoContainer.style.marginTop = "8px";
                videoContainer.style.backgroundColor = "#000";
                videoContainer.style.borderRadius = "6px";
                videoContainer.style.overflow = "hidden";

                const videoPlayer = document.createElement("video");
                videoPlayer.controls = true;
                videoPlayer.style.width = "100%";
                videoPlayer.style.maxHeight = "250px";
                videoPlayer.style.display = "block";
                
                videoContainer.appendChild(videoPlayer);

                // Добавляем виджеты в ноду
                this.addDOMWidget("upload_vid_widget", "div", uploadContainer, { serialize: false, hideOnZoom: false });
                this.addDOMWidget("player_vid_widget", "div", videoContainer, { serialize: false, hideOnZoom: false });

                // Функция обновления плеера
                const updatePlayer = (filename, type, subfolder = "") => {
                    if (!filename) return;
                    // Используем встроенный стриминг ComfyUI, браузер сам запросит нужные байты
                    const src = api.apiURL(`/view?filename=${encodeURIComponent(filename)}&type=${type}&subfolder=${subfolder}`);
                    if (videoPlayer.src !== src) {
                        videoPlayer.src = src;
                        videoPlayer.load();
                    }
                };

                // Инициализация плеера из текстового поля (если путь уже указан)
                if (fileWidget && fileWidget.value) {
                    const filename = fileWidget.value.split(/[/\\]/).pop();
                    if (filename) updatePlayer(filename, "input");
                }

                this.onResize?.(this.size);
                this.size[1] += 300; // Увеличиваем высоту узла под плеер

                return r;
            };
        }
    },

    // === 3. ПЕРЕХВАТ РЕЗУЛЬТАТА ПОСЛЕ ВЫПОЛНЕНИЯ (Синхронизация с Python) ===
    async setup() {
        api.addEventListener("executed", (e) => {
            const data = e.detail;
            const node = app.graph.getNodeById(data.node);
            
            // Проверяем, что это наш узел и он вернул UI-данные
            if (node && node.type === "OreX_AdvancedVideoLoad" && data.output && data.output.video) {
                const vidInfo = data.output.video[0];
                const domWidget = node.widgets.find(w => w.name === "player_vid_widget");
                
                if (domWidget && domWidget.element) {
                    const videoEl = domWidget.element.querySelector("video");
                    if (videoEl) {
                        const src = api.apiURL(`/view?filename=${encodeURIComponent(vidInfo.filename)}&type=${vidInfo.type}&subfolder=${vidInfo.subfolder}`);
                        videoEl.src = src;
                        videoEl.play().catch(err => console.log("Autoplay prevented:", err));
                    }
                }
            }
        });
    }
});