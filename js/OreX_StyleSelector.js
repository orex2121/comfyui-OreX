import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// Внедряем CSS-стили
const styleEl = document.createElement("style");
styleEl.textContent = `
.orex-styles-container {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    height: 100%;
    padding: 8px;
    background: var(--bg-color, #1e1e1e);
    border-radius: 8px;
    box-sizing: border-box;
}
.orex-tags-container {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    max-height: 85px;
    overflow-y: auto;
    padding-bottom: 6px;
    border-bottom: 1px solid #333;
    flex-shrink: 0; 
}
.orex-tags-container:empty {
    display: none;
    border-bottom: none;
    padding-bottom: 0;
}
.orex-tag {
    background: #333;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    color: #fff;
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    cursor: grab;
    user-select: none;
    transition: background 0.2s, border-color 0.2s;
}
.orex-tag:active {
    cursor: grabbing;
}
.orex-tag.drag-over {
    border-color: #4CAF50;
    background: #444;
}
.orex-tag-close {
    cursor: pointer;
    color: #ff5555;
    font-weight: bold;
    font-size: 14px;
    line-height: 1;
}
.orex-tag-close:hover {
    color: #ff8888;
}

/* Строка поиска и кнопка сброса */
.orex-search-row {
    display: flex;
    gap: 8px;
    width: 100%;
    align-items: center;
    flex-shrink: 0; 
}
.orex-reset-btn {
    background: transparent;
    border: 1px solid #555;
    color: #ccc;
    border-radius: 50%;
    width: 28px;
    height: 28px;
    min-width: 28px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    transition: 0.2s;
    padding: 0;
}
.orex-reset-btn:hover {
    background: #444;
    color: #fff;
    border-color: #888;
}
.orex-search-bar {
    flex-grow: 1;
    padding: 6px 10px;
    background: #00000050;
    border: 1px solid #444;
    border-radius: 4px;
    color: #fff;
    box-sizing: border-box;
}

/* Сетка стилей */
.orex-styles-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(77px, 1fr));
    gap: 10px;
    overflow-y: auto;
    flex-grow: 1;       
    min-height: 0;      
    align-content: start;
    width: 100%;
    box-sizing: border-box;
}
.orex-style-card {
    background: #2a2a2a;
    border: 2px solid transparent;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
    height: 100px; 
}
.orex-style-card:hover {
    transform: scale(1.02);
}
.orex-style-card.selected {
    border-color: #4CAF50;
}

/* Галочка выбора слева вверху */
.orex-style-card.selected::after {
    content: '✓';
    position: absolute;
    top: 5px;
    left: 5px;
    background: #4CAF50;
    color: white;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    z-index: 20;
}

/* Кнопка ИЗБРАННОГО справа вверху */
.orex-fav-btn {
    position: absolute;
    top: 5px;
    right: 5px;
    font-size: 16px;
    cursor: pointer;
    z-index: 20;
    color: rgba(0,0,0,0.5);
    text-shadow: 0px 0px 2px rgba(255,255,255,0.8);
    transition: transform 0.2s, color 0.2s;
    user-select: none;
}
.orex-fav-btn:hover {
    transform: scale(1.25);
}
.orex-fav-btn.favorited {
    color: #ff4444;
    text-shadow: 0px 0px 4px rgba(0,0,0,0.5);
}

.orex-style-card > img {
    width: 100%;
    height: 77px;
    object-fit: cover;
    background: #111;
}

/* --- Стили для слайдера До/После --- */
.orex-slider-container {
    position: relative;
    width: 100%;
    height: 77px;
    background: #111;
    flex-shrink: 0;
}
.orex-slider-container .img-after,
.orex-slider-container .img-before {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none; /* Мышь сквозь картинки */
}
.orex-slider-container .img-before {
    clip-path: polygon(0 0, 50% 0, 50% 100%, 0 100%);
}
.orex-slider-line {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 2px;
    background: white;
    transform: translateX(-50%);
    pointer-events: none;
    box-shadow: 0 0 3px rgba(0,0,0,0.5);
    z-index: 5;
}
.orex-slider-range {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: col-resize;
    margin: 0;
    z-index: 10; 
}
/* ---------------------------------- */

.orex-style-card .title {
    padding: 4px;
    font-size: 8.5px;
    text-align: center;
    color: #ddd;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    background: #222;
}
.orex-styles-grid::-webkit-scrollbar { width: 8px; }
.orex-styles-grid::-webkit-scrollbar-track { background: #111; border-radius: 4px; }
.orex-styles-grid::-webkit-scrollbar-thumb { background: #555; border-radius: 4px; }
.orex-styles-grid::-webkit-scrollbar-thumb:hover { background: #777; }

/* Тултип */
.orex-style-tooltip {
    position: fixed;
    background: #1a1a1acc;
    backdrop-filter: blur(4px);
    border: 1px solid #444;
    border-radius: 8px;
    padding: 12px;
    width: 260px;
    z-index: 10001;
    pointer-events: none;
    display: none;
    flex-direction: column;
    gap: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.7);
    font-family: sans-serif;
}
.orex-style-tooltip img {
    width: 100%;
    height: 150px;
    object-fit: cover;
    border-radius: 4px;
    background: #111;
}
.orex-style-tooltip h4 { 
    margin: 0; 
    color: #fff; 
    font-size: 14px;
    font-weight: 600;
}
.orex-style-tooltip .prompt-block {
    font-size: 11px;
    line-height: 1.4;
    word-break: break-word;
    max-height: 120px;
    overflow-y: auto;
}
.orex-style-tooltip .pos { color: #4CAF50; }
.orex-style-tooltip .neg { color: #F44336; }

/* Управление, масштаб, полноэкранный режим и редактор */
.orex-select-all-btn,
.orex-fullscreen-btn {
    height: 28px;
    min-width: 28px;
    border-radius: 5px;
    border: 1px solid #555;
    background: #333;
    color: #fff;
    cursor: pointer;
    padding: 0 7px;
    flex-shrink: 0;
}
.orex-select-all-btn:hover { background: #454545; }
.orex-fullscreen-btn {
    background: #20b94b;
    border-color: #55e777;
    color: #071a0b;
    font-weight: bold;
    font-size: 17px;
}
.orex-fullscreen-btn:hover { background: #43dc68; }
.orex-scale-control {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
    color: #ddd;
    font-size: 14px;
}
.orex-scale-control input { width: 72px; cursor: pointer; }
.orex-styles-grid {
    grid-template-columns: repeat(auto-fill, minmax(var(--orex-card-width, 77px), 1fr));
}
.orex-style-card {
    height: var(--orex-card-height, 100px);
    transition: height 0.18s ease, transform 0.18s ease, border-color 0.18s ease;
}
.orex-style-card > img,
.orex-slider-container {
    height: var(--orex-image-height, 77px);
    transition: height 0.18s ease;
}
.orex-edit-btn {
    position: absolute;
    top: 28px;
    right: 5px;
    z-index: 20;
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 4px;
    background: rgba(30, 30, 30, 0.78);
    color: #fff;
    cursor: pointer;
    padding: 0;
    line-height: 20px;
    font-size: 15px;
}
.orex-edit-btn:hover { background: #4CAF50; }
.orex-styles-container:fullscreen {
    width: 100vw;
    height: 100vh;
    padding: 16px;
    border-radius: 0;
    background: var(--bg-color, #151515);
}
.orex-edit-overlay {
    position: fixed;
    inset: 0;
    z-index: 20000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.66);
}
.orex-edit-dialog {
    width: min(720px, 88vw);
    height: min(720px, 88vh);
    min-width: 420px;
    min-height: 520px;
    resize: both;
    overflow: auto;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 16px;
    border: 1px solid #666;
    border-radius: 8px;
    background: #202020;
    color: #fff;
    box-shadow: 0 12px 38px rgba(0, 0, 0, 0.75);
}
.orex-edit-dialog h3 { margin: 0 0 4px; }
.orex-edit-dialog label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: #ccc;
}
.orex-edit-dialog input,
.orex-edit-dialog textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #555;
    border-radius: 4px;
    background: #111;
    color: #fff;
    padding: 7px;
    font: 13px sans-serif;
}
.orex-edit-dialog textarea { resize: none; }
.orex-edit-dialog .orex-prompt-field { flex: 8 1 160px; }
.orex-edit-dialog .orex-negative-field { flex: 3 1 80px; }
.orex-edit-dialog label textarea { flex: 1; min-height: 0; }
.orex-edit-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: auto;
}
.orex-edit-actions button {
    border: 0;
    border-radius: 5px;
    padding: 8px 18px;
    cursor: pointer;
}
.orex-edit-save { background: #4CAF50; color: white; }
.orex-edit-cancel { background: #555; color: white; }
.orex-edit-error { color: #ff7777; min-height: 16px; font-size: 12px; }
`;
document.head.appendChild(styleEl);

let tooltip = document.getElementById("orex-style-tooltip");
if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "orex-style-tooltip";
    tooltip.className = "orex-style-tooltip";
    document.body.appendChild(tooltip);
}

app.registerExtension({
    name: "OreX.StyleSelector",
    async nodeCreated(node) {
        if (node.comfyClass === "OrexStyleSelector") {
            
            const selectStylesWidget = node.widgets.find(w => w.name === "select_styles");
            const previewScaleWidget = node.widgets.find(w => w.name === "preview_scale");

            const hideWidget = (widget) => {
                if (!widget) return;
                widget.computeSize = () => [0, -4];
                widget.draw = () => {};
                if (widget.inputEl) widget.inputEl.style.display = "none";
            };
            hideWidget(selectStylesWidget);
            hideWidget(previewScaleWidget);

            const container = document.createElement("div");
            container.className = "orex-styles-container";

            const tagsContainer = document.createElement("div");
            tagsContainer.className = "orex-tags-container";
            container.appendChild(tagsContainer);

            const searchRow = document.createElement("div");
            searchRow.className = "orex-search-row";

            const resetBtn = document.createElement("button");
            resetBtn.className = "orex-reset-btn";
            resetBtn.innerHTML = "↺";
            resetBtn.title = "Clear all styles";
            resetBtn.onclick = () => updateSelection([]);
            searchRow.appendChild(resetBtn);

            const selectAllBtn = document.createElement("button");
            selectAllBtn.className = "orex-select-all-btn";
            selectAllBtn.innerHTML = "✓✓";
            selectAllBtn.title = "Select all styles in this file";
            selectAllBtn.onclick = () => {
                const selected = parseSelection();
                const additions = allStyles.map((item, index) => ({
                    set: currentStyleSet,
                    name: item.name,
                    index,
                }));
                updateSelection([...selected, ...additions]);
            };
            searchRow.appendChild(selectAllBtn);

            const scaleControl = document.createElement("div");
            scaleControl.className = "orex-scale-control";
            const minusLabel = document.createElement("span");
            minusLabel.textContent = "−";
            const scaleSlider = document.createElement("input");
            scaleSlider.type = "range";
            scaleSlider.min = "0.5";
            scaleSlider.max = "2";
            scaleSlider.step = "0.05";
            scaleSlider.value = String(Number(previewScaleWidget?.value) || 1);
            scaleSlider.title = "Preview size";
            const plusLabel = document.createElement("span");
            plusLabel.textContent = "+";
            scaleControl.append(minusLabel, scaleSlider, plusLabel);
            searchRow.appendChild(scaleControl);

            const searchInput = document.createElement("input");
            searchInput.className = "orex-search-bar";
            searchInput.placeholder = "🔍 Search styles...";
            searchRow.appendChild(searchInput);

            const fullscreenBtn = document.createElement("button");
            fullscreenBtn.className = "orex-fullscreen-btn";
            fullscreenBtn.innerHTML = "⛶";
            fullscreenBtn.title = "Open fullscreen";
            fullscreenBtn.onclick = async () => {
                if (document.fullscreenElement === container) {
                    await document.exitFullscreen();
                } else {
                    await container.requestFullscreen();
                }
            };
            searchRow.appendChild(fullscreenBtn);

            container.appendChild(searchRow);

            const grid = document.createElement("div");
            grid.className = "orex-styles-grid";
            container.appendChild(grid);

            node.addDOMWidget("styles_grid", "custom", container, {
                getValue: () => selectStylesWidget ? selectStylesWidget.value : "",
                setValue: (v) => { if (selectStylesWidget) selectStylesWidget.value = v; },
                hideOnZoom: false
            });

            node.setSize([460, 520]);

            let allStyles = [];
            let favoriteNames = [];
            let draggedStyle = null;
            let currentStyleSet = "";
            let loadSequence = 0;
            const styleCache = new Map();

            const selectionKey = (entry) => {
                const indexPart = Number.isInteger(entry.index) ? entry.index : "";
                return `${entry.set}\u0000${entry.name}\u0000${indexPart}`;
            };

            const parseSelection = () => {
                const raw = selectStylesWidget?.value;
                if (!raw) return [];
                if (Array.isArray(raw)) {
                    return raw.map(value => typeof value === "string"
                        ? { set: currentStyleSet, name: value }
                        : value
                    ).filter(value => value?.set && value?.name);
                }
                try {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) {
                        return parsed.map(value => typeof value === "string"
                            ? { set: currentStyleSet, name: value }
                            : value
                        ).filter(value => value?.set && value?.name);
                    }
                } catch (_) {
                    // Backward compatibility with the old comma-separated value.
                }
                return String(raw).split(",").map(name => name.trim()).filter(Boolean)
                    .map(name => ({ set: currentStyleSet, name }));
            };

            const normalizeSelection = (entries) => {
                const unique = new Map();
                entries.filter(entry => entry?.set && entry?.name)
                    .forEach(entry => {
                        const normalized = { set: entry.set, name: entry.name };
                        if (Number.isInteger(entry.index) && entry.index >= 0) normalized.index = entry.index;
                        unique.set(selectionKey(normalized), normalized);
                    });
                return [...unique.values()];
            };

            const getImageUrl = (imgName, styleSet = currentStyleSet) => {
                if (!imgName) return "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
                if (imgName.startsWith("http") || imgName.startsWith("data:")) return imgName;
                return `/orex/image?style_set=${encodeURIComponent(styleSet)}&img=${encodeURIComponent(imgName)}`;
            };

            const applyPreviewScale = () => {
                const savedScale = Number(scaleSlider.value);
                const scale = Math.min(2, Math.max(0.5, Number.isFinite(savedScale) ? savedScale : 1));
                const fullscreenFactor = document.fullscreenElement === container ? 2 : 1;
                const imageSize = 77 * scale * fullscreenFactor;
                container.style.setProperty("--orex-card-width", `${imageSize}px`);
                container.style.setProperty("--orex-image-height", `${imageSize}px`);
                container.style.setProperty("--orex-card-height", `${imageSize + 23}px`);
                fullscreenBtn.innerHTML = document.fullscreenElement === container ? "✕" : "⛶";
                fullscreenBtn.title = document.fullscreenElement === container ? "Close fullscreen" : "Open fullscreen";
                if (document.fullscreenElement === container) {
                    container.appendChild(tooltip);
                } else if (tooltip.parentElement === container) {
                    document.body.appendChild(tooltip);
                }
            };

            const syncPreviewScaleFromWidget = () => {
                const restoredScale = Number(previewScaleWidget?.value);
                const scale = Math.min(2, Math.max(0.5, Number.isFinite(restoredScale) ? restoredScale : 1));
                scaleSlider.value = String(scale);
                applyPreviewScale();
            };

            // LiteGraph restores widgets_values after nodeCreated. Synchronize the
            // DOM slider only after that restore has completed.
            const originalOnConfigure = node.onConfigure;
            node.onConfigure = function () {
                const result = originalOnConfigure?.apply(this, arguments);
                requestAnimationFrame(syncPreviewScaleFromWidget);
                return result;
            };

            scaleSlider.addEventListener("input", () => {
                const scale = Number(scaleSlider.value);
                if (previewScaleWidget) {
                    previewScaleWidget.value = scale;
                    previewScaleWidget.callback?.(scale);
                }
                applyPreviewScale();
                node.setDirtyCanvas(true, true);
            });
            document.addEventListener("fullscreenchange", applyPreviewScale);
            syncPreviewScaleFromWidget();

            const fetchFavoritesList = async () => {
                try {
                    const response = await api.fetchApi("/orex/styles?name=favorite");
                    if (response.ok) {
                        const favData = await response.json();
                        favoriteNames = favData.map(s => s.name);
                    }
                } catch (e) {
                    console.warn("Failed to load favorites.json", e);
                }
            };

            const updateSelection = (newSelectionArray) => {
                const cleanedSelection = normalizeSelection(newSelectionArray);
                if (selectStylesWidget) {
                    selectStylesWidget.value = JSON.stringify(cleanedSelection);
                    selectStylesWidget.callback?.(selectStylesWidget.value);
                }
                renderTags(cleanedSelection);

                const selectedKeys = new Set(cleanedSelection.map(selectionKey));
                grid.querySelectorAll(".orex-style-card").forEach(card => {
                    card.classList.toggle("selected", selectedKeys.has(card.dataset.selectionKey));
                });
                node.setDirtyCanvas(true, true);
            };

            const renderTags = (selectedArray) => {
                tagsContainer.innerHTML = "";
                selectedArray.forEach(entry => {
                    const entryKey = selectionKey(entry);
                    const tag = document.createElement("div");
                    tag.className = "orex-tag";
                    tag.draggable = true;

                    tag.addEventListener("dragstart", (e) => {
                        draggedStyle = entryKey;
                        e.dataTransfer.effectAllowed = "move";
                        setTimeout(() => tag.style.opacity = "0.4", 0);
                    });

                    tag.addEventListener("dragend", () => {
                        tag.style.opacity = "1";
                        draggedStyle = null;
                        document.querySelectorAll(".orex-tag").forEach(t => t.classList.remove("drag-over"));
                    });

                    tag.addEventListener("dragover", (e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        tag.classList.add("drag-over");
                    });
                    tag.addEventListener("dragleave", () => tag.classList.remove("drag-over"));

                    tag.addEventListener("drop", (e) => {
                        e.preventDefault();
                        tag.classList.remove("drag-over");
                        if (draggedStyle && draggedStyle !== entryKey) {
                            const currentSelection = parseSelection();
                            const fromIndex = currentSelection.findIndex(item => selectionKey(item) === draggedStyle);
                            const toIndex = currentSelection.findIndex(item => selectionKey(item) === entryKey);
                            if (fromIndex !== -1 && toIndex !== -1) {
                                const [moved] = currentSelection.splice(fromIndex, 1);
                                currentSelection.splice(toIndex, 0, moved);
                                updateSelection(currentSelection);
                            }
                        }
                    });

                    const nameSpan = document.createElement("span");
                    const styleData = styleCache.get(entryKey);
                    nameSpan.textContent = `${entry.set}: ${styleData ? (styleData.name_cn || styleData.name) : entry.name}`;

                    const closeBtn = document.createElement("span");
                    closeBtn.className = "orex-tag-close";
                    closeBtn.textContent = "×";
                    closeBtn.onclick = (e) => {
                        e.stopPropagation();
                        updateSelection(parseSelection().filter(item => selectionKey(item) !== entryKey));
                    };

                    tag.append(nameSpan, closeBtn);
                    tagsContainer.appendChild(tag);
                });
            };

            const openStyleEditor = (item, itemIndex) => {
                const editingStyleSet = currentStyleSet;
                const originalName = item.name;
                const overlay = document.createElement("div");
                overlay.className = "orex-edit-overlay";
                const dialog = document.createElement("div");
                dialog.className = "orex-edit-dialog";

                const heading = document.createElement("h3");
                heading.textContent = `Edit style — ${editingStyleSet}.json`;
                dialog.appendChild(heading);

                const addField = (labelText, value, options = {}) => {
                    const label = document.createElement("label");
                    label.textContent = labelText;
                    if (options.className) label.classList.add(options.className);
                    const field = options.multiline
                        ? document.createElement("textarea")
                        : document.createElement("input");
                    if (options.type) field.type = options.type;
                    if (options.rows) field.rows = options.rows;
                    if (options.min !== undefined) field.min = String(options.min);
                    if (options.max !== undefined) field.max = String(options.max);
                    field.value = value ?? "";
                    label.appendChild(field);
                    dialog.appendChild(label);
                    return field;
                };

                const positionField = addField("Position", itemIndex + 1, {
                    type: "number", min: 1, max: allStyles.length
                });
                const nameField = addField("name", item.name || "");
                const nameCnField = addField("name_cn", item.name_cn || "");
                const thumbnailValue = Array.isArray(item.thumbnail)
                    ? JSON.stringify(item.thumbnail)
                    : (item.thumbnail || "");
                const thumbnailField = addField("thumbnail", thumbnailValue);
                const promptField = addField("prompt", item.prompt || "", {
                    multiline: true, rows: 8, className: "orex-prompt-field"
                });
                const negativeField = addField("negative_prompt", item.negative_prompt || "", {
                    multiline: true, rows: 3, className: "orex-negative-field"
                });

                const errorText = document.createElement("div");
                errorText.className = "orex-edit-error";
                dialog.appendChild(errorText);

                const actions = document.createElement("div");
                actions.className = "orex-edit-actions";
                const cancelBtn = document.createElement("button");
                cancelBtn.className = "orex-edit-cancel";
                cancelBtn.textContent = "Cancel";
                cancelBtn.onclick = () => overlay.remove();
                const saveBtn = document.createElement("button");
                saveBtn.className = "orex-edit-save";
                saveBtn.textContent = "Save";
                saveBtn.onclick = async () => {
                    errorText.textContent = "";
                    let thumbnail = thumbnailField.value;
                    if (thumbnail.trim().startsWith("[")) {
                        try {
                            const parsedThumbnail = JSON.parse(thumbnail);
                            if (!Array.isArray(parsedThumbnail) || !parsedThumbnail.every(value => typeof value === "string")) {
                                throw new Error("Thumbnail array must contain strings only");
                            }
                            thumbnail = parsedThumbnail;
                        } catch (error) {
                            errorText.textContent = `thumbnail: ${error.message}`;
                            return;
                        }
                    }
                    saveBtn.disabled = true;
                    try {
                        const response = await api.fetchApi("/orex/style", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                style_set: editingStyleSet,
                                original_index: itemIndex,
                                original_name: originalName,
                                expected_style: item,
                                position: Number(positionField.value),
                                style: {
                                    name: nameField.value,
                                    name_cn: nameCnField.value,
                                    thumbnail,
                                    prompt: promptField.value,
                                    negative_prompt: negativeField.value
                                }
                            })
                        });
                        const result = await response.json();
                        if (!response.ok) throw new Error(result.error || "Save failed");

                        const newIndex = result.position - 1;
                        const renamedSelection = parseSelection().map(entry => {
                            if (entry.set !== editingStyleSet) return entry;
                            if (entry.index === itemIndex || (!Number.isInteger(entry.index) && entry.name === originalName)) {
                                return { set: editingStyleSet, name: result.style.name, index: newIndex };
                            }
                            if (!Number.isInteger(entry.index)) return entry;
                            if (newIndex < itemIndex && entry.index >= newIndex && entry.index < itemIndex) {
                                return { ...entry, index: entry.index + 1 };
                            }
                            if (newIndex > itemIndex && entry.index > itemIndex && entry.index <= newIndex) {
                                return { ...entry, index: entry.index - 1 };
                            }
                            return entry;
                        });
                        updateSelection(renamedSelection);
                        overlay.remove();
                        await loadStyles(editingStyleSet);
                    } catch (error) {
                        errorText.textContent = error.message;
                        saveBtn.disabled = false;
                    }
                };
                actions.append(cancelBtn, saveBtn);
                dialog.appendChild(actions);
                overlay.appendChild(dialog);
                (document.fullscreenElement === container ? container : document.body).appendChild(overlay);
                nameField.focus();
            };

            const renderStyles = (filter = "") => {
                grid.innerHTML = "";
                const selectedStyles = parseSelection();
                const selectedKeys = new Set(selectedStyles.map(selectionKey));

                renderTags(selectedStyles);

                allStyles.forEach((item, itemIndex) => {
                    const displayName = item.name_cn || item.name;
                    if (filter && !displayName.toLowerCase().includes(filter.toLowerCase())) return;

                    const cardEntry = { set: currentStyleSet, name: item.name, index: itemIndex };
                    const cardKey = selectionKey(cardEntry);
                    const card = document.createElement("div");
                    card.className = "orex-style-card";
                    card.dataset.selectionKey = cardKey;
                    if (selectedKeys.has(cardKey)) card.classList.add("selected");

                    // === Добавляем Сердечко ===
                    const favBtn = document.createElement("div");
                    const isFav = favoriteNames.includes(item.name);
                    favBtn.className = "orex-fav-btn" + (isFav ? " favorited" : "");
                    favBtn.innerHTML = "❤";
                    favBtn.title = isFav ? "Remove from favorites" : "Add to favorites";
                    
                    favBtn.onclick = async (e) => {
                        e.stopPropagation(); 
                        const currentlyFav = favBtn.classList.contains("favorited");
                        const action = currentlyFav ? "remove" : "add";
                        
                        if (currentlyFav) {
                            favBtn.classList.remove("favorited");
                            favBtn.title = "Add to favorites";
                            favoriteNames = favoriteNames.filter(n => n !== item.name);
                        } else {
                            favBtn.classList.add("favorited");
                            favBtn.title = "Remove from favorites";
                            favoriteNames.push(item.name);
                        }
                        
                        try {
                            await api.fetchApi("/orex/favorite", {
                                method: "POST",
                                body: JSON.stringify({ style: item, action: action })
                            });
                        } catch (err) {
                            console.error("[OreX] Error saving favorite:", err);
                        }
                    };
                    card.appendChild(favBtn);

                    const editBtn = document.createElement("button");
                    editBtn.className = "orex-edit-btn";
                    editBtn.textContent = "✎";
                    editBtn.title = "Edit style";
                    editBtn.onclick = (event) => {
                        event.stopPropagation();
                        tooltip.style.display = "none";
                        openStyleEditor(item, itemIndex);
                    };
                    card.appendChild(editBtn);

                    // === Логика отрисовки картинки ИЛИ слайдера ===
                    const hasSlider = item.thumbnail_variant === "compareSlider" && Array.isArray(item.thumbnail) && item.thumbnail.length >= 2;
                    
                    if (hasSlider) {
                        const sliderContainer = document.createElement("div");
                        sliderContainer.className = "orex-slider-container";
                        
                        const imgAfter = document.createElement("img");
                        imgAfter.className = "img-after";
                        imgAfter.src = getImageUrl(item.thumbnail[0]); // Результат
                        imgAfter.onerror = () => { imgAfter.src = getImageUrl(""); };
                        
                        const imgBefore = document.createElement("img");
                        imgBefore.className = "img-before";
                        imgBefore.src = getImageUrl(item.thumbnail[1]); // Исходник
                        imgBefore.onerror = () => { imgBefore.src = getImageUrl(""); };
                        
                        const line = document.createElement("div");
                        line.className = "orex-slider-line";
                        
                        const range = document.createElement("input");
                        range.type = "range";
                        range.min = 0;
                        range.max = 100;
                        range.value = 50;
                        range.className = "orex-slider-range";
                        
                        // Сдвиг линии
                        range.addEventListener("input", (e) => {
                            const val = e.target.value;
                            imgBefore.style.clipPath = `polygon(0 0, ${val}% 0, ${val}% 100%, 0 100%)`;
                            line.style.left = `${val}%`;
                        });

                        // Предотвращение выделения карточки при перетаскивании ползунка
                        let startX = 0;
                        range.addEventListener("pointerdown", (e) => {
                            startX = e.clientX;
                        });
                        range.addEventListener("click", (e) => {
                            if (Math.abs(e.clientX - startX) > 5) {
                                e.stopPropagation(); 
                            }
                        });

                        sliderContainer.appendChild(imgAfter);
                        sliderContainer.appendChild(imgBefore);
                        sliderContainer.appendChild(line);
                        sliderContainer.appendChild(range);
                        
                        card.appendChild(sliderContainer);
                    } else {
                        // Обычное изображение, если нет compareSlider
                        const img = document.createElement("img");
                        let imgName = "";
                        if (Array.isArray(item.thumbnail)) {
                            imgName = item.thumbnail[0];
                        } else if (typeof item.thumbnail === "string") {
                            imgName = item.thumbnail;
                        }
                        img.src = getImageUrl(imgName);
                        img.onerror = () => { img.src = getImageUrl(""); };
                        
                        card.appendChild(img);
                    }
                    // ===============================================

                    const title = document.createElement("div");
                    title.className = "title";
                    title.textContent = displayName;
                    card.appendChild(title);

                    card.onclick = () => {
                        const currentSelected = parseSelection();
                        const alreadySelected = currentSelected.some(entry => selectionKey(entry) === cardKey);
                        updateSelection(alreadySelected
                            ? currentSelected.filter(entry => selectionKey(entry) !== cardKey)
                            : [...currentSelected, cardEntry]
                        );
                    };

                    card.onmouseenter = () => {
                        const cardRect = card.getBoundingClientRect();
                        const containerRect = container.getBoundingClientRect();
                        
                        // Для тултипа берем первую картинку всегда (даже если есть слайдер)
                        let tImg = "";
                        if (Array.isArray(item.thumbnail)) {
                            tImg = item.thumbnail[0];
                        } else if (typeof item.thumbnail === "string") {
                            tImg = item.thumbnail;
                        }
                        
                        tooltip.replaceChildren();
                        const tooltipImage = document.createElement("img");
                        tooltipImage.src = getImageUrl(tImg);
                        tooltipImage.onerror = () => { tooltipImage.src = getImageUrl(""); };
                        const tooltipTitle = document.createElement("h4");
                        tooltipTitle.textContent = displayName;
                        tooltip.append(tooltipImage, tooltipTitle);
                        const appendPrompt = (label, text, className) => {
                            if (!text) return;
                            const block = document.createElement("div");
                            block.className = `prompt-block ${className}`;
                            const strong = document.createElement("b");
                            strong.textContent = `${label}: `;
                            block.append(strong, document.createTextNode(String(text)));
                            tooltip.appendChild(block);
                        };
                        appendPrompt("Positive", item.prompt, "pos");
                        appendPrompt("Negative", item.negative_prompt, "neg");
                        
                        tooltip.style.display = "flex";

                        const tooltipWidth = tooltip.offsetWidth;
                        const gap = 15;
                        const cardCenterX = cardRect.left + (cardRect.width / 2);
                        const containerCenterX = containerRect.left + (containerRect.width / 2);
                        const leftOfNode = containerRect.left - tooltipWidth - gap;
                        const rightOfNode = containerRect.right + gap;
                        const leftFits = leftOfNode >= 10;
                        const rightFits = rightOfNode + tooltipWidth <= window.innerWidth - 10;
                        const preferLeft = cardCenterX <= containerCenterX;

                        let leftPos;
                        if (preferLeft && leftFits) {
                            leftPos = leftOfNode;
                        } else if (!preferLeft && rightFits) {
                            leftPos = rightOfNode;
                        } else if (leftFits) {
                            leftPos = leftOfNode;
                        } else if (rightFits) {
                            leftPos = rightOfNode;
                        } else {
                            const fallback = preferLeft ? leftOfNode : rightOfNode;
                            leftPos = Math.min(
                                Math.max(10, fallback),
                                Math.max(10, window.innerWidth - tooltipWidth - 10)
                            );
                        }
                        tooltip.style.left = leftPos + "px";

                        let topPos = cardRect.top + (cardRect.height / 2) - (tooltip.offsetHeight / 2);
                        if (topPos < 10) topPos = 10;
                        if (topPos + tooltip.offsetHeight > window.innerHeight) {
                            topPos = window.innerHeight - tooltip.offsetHeight - 10;
                        }
                        tooltip.style.top = topPos + "px";
                    };

                    card.onmouseleave = () => {
                        tooltip.style.display = "none";
                    };

                    grid.appendChild(card);
                });
            };

            const loadStyles = async (jsonName) => {
                const requestId = ++loadSequence;
                grid.innerHTML = "<div style='color:#fff; text-align:center; padding:20px;'>Loading styles...</div>";
                currentStyleSet = jsonName;
                try {
                    await fetchFavoritesList();

                    const response = await api.fetchApi(`/orex/styles?name=${encodeURIComponent(jsonName)}`);
                    if (!response.ok) throw new Error("Network Error");
                    const loadedStyles = await response.json();
                    if (requestId !== loadSequence) return;

                    allStyles = loadedStyles;
                    allStyles.forEach((item, index) => styleCache.set(
                        selectionKey({ set: jsonName, name: item.name, index }), item
                    ));
                    const enrichedSelection = parseSelection().map(entry => {
                        if (entry.set !== jsonName || Number.isInteger(entry.index)) return entry;
                        const index = allStyles.findIndex(item => item.name === entry.name);
                        return index >= 0 ? { ...entry, index } : entry;
                    });
                    updateSelection(enrichedSelection);
                    renderStyles(searchInput.value);
                } catch (e) {
                    if (requestId !== loadSequence) return;
                    grid.innerHTML = "<div style='color:#ff5555; text-align:center; padding:20px;'>Failed to load styles</div>";
                    console.error("[OreX StyleSelector] Error:", e);
                }
            };

            searchInput.addEventListener("input", (e) => renderStyles(e.target.value));

            const stylesComboWidget = node.widgets.find(w => w.name === "styles");
            if (stylesComboWidget) {
                const origCallback = stylesComboWidget.callback;
                stylesComboWidget.callback = function (val) {
                    loadStyles(val);
                    if (origCallback) origCallback.apply(this, arguments);
                };
                setTimeout(() => loadStyles(stylesComboWidget.value), 100);
            }
        }
    }
});