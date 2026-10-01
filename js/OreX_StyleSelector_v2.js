import { app } from "../../scripts/app.js";

const NODE_CLASS = "orex String Selector v2";
const FAVORITES_URL = "/orex/string-selector-v2/favorites";
const FAVORITE_URL = "/orex/string-selector-v2/favorite";
const REORDER_URL = "/orex/string-selector-v2/reorder";
const BACKUP_URL = "/orex/string-selector-v2/backup";

function makeEntryId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function updateFavorite(action, entry) {
    const response = await fetch(FAVORITE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, entry }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
}

async function reorderFavorite(id, beforeId) {
    const response = await fetch(REORDER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, before_id: beforeId }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
}

async function saveSystemPromptBackup(button) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Saving...";
    try {
        let fileHandle = null;
        if (globalThis.showSaveFilePicker) {
            fileHandle = await globalThis.showSaveFilePicker({
                suggestedName: "OreX_StringSelector_v2.json",
                types: [{
                    description: "JSON file",
                    accept: { "application/json": [".json"] },
                }],
            });
        }

        const response = await fetch(BACKUP_URL);
        if (!response.ok) throw new Error(await response.text());
        const blob = await response.blob();

        if (fileHandle) {
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
        } else {
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "OreX_StringSelector_v2.json";
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    } catch (error) {
        if (error?.name !== "AbortError") {
            console.error("[OreX StringSelector v2] Failed to save backup", error);
        }
    } finally {
        button.disabled = false;
        button.textContent = originalText;
    }
}

function makeButton(text, primary = false) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = text;
    Object.assign(element.style, {
        flex: "1 1 0",
        minHeight: "34px",
        borderRadius: "6px",
        border: primary ? "1px solid #43a85b" : "1px solid #686868",
        background: primary ? "#28773a" : "#3b3b3b",
        color: "#f2f2f2",
        fontWeight: "600",
        cursor: "pointer",
    });
    return element;
}

function parsePrompts(widget) {
    try {
        const value = JSON.parse(String(widget.value ?? "[]"));
        return Array.isArray(value) ? value.map((item) => String(item ?? "")) : [];
    } catch {
        return [];
    }
}

function openPromptEditor(node, namesWidget, promptWidget, storageWidget, selectWidget, index, refresh, syncFavorite) {
    document.querySelector(`[data-orex-prompt-editor="${node.id}"]`)?.remove();

    const names = String(namesWidget.value ?? "").split("\n");
    const prompts = parsePrompts(storageWidget);
    if (index < 0 || index >= names.length) return;
    while (prompts.length < names.length) prompts.push("");
    const savedEntries = Array.isArray(node.properties?.orexPromptEntries)
        ? node.properties.orexPromptEntries
        : [];
    const savedType = ["prompt", "style", "edit", "llm"].includes(savedEntries[index]?.type)
        ? savedEntries[index].type
        : "prompt";

    const overlay = document.createElement("div");
    overlay.dataset.orexPromptEditor = String(node.id);
    Object.assign(overlay.style, {
        position: "fixed", inset: "0", zIndex: "100000", display: "flex",
        alignItems: "center", justifyContent: "center", padding: "24px",
        boxSizing: "border-box", background: "rgba(0,0,0,.62)", pointerEvents: "auto",
    });

    const panel = document.createElement("div");
    Object.assign(panel.style, {
        width: "min(760px,88vw)", maxHeight: "86vh", display: "flex",
        flexDirection: "column", gap: "9px", padding: "16px", boxSizing: "border-box",
        border: "1px solid #666", borderRadius: "10px", background: "#292929",
        boxShadow: "0 18px 60px rgba(0,0,0,.55)", color: "#eee",
        font: "13px Arial,sans-serif",
    });

    const title = document.createElement("div");
    title.textContent = `Edit - ${names[index]}`;
    Object.assign(title.style, { fontSize: "15px", fontWeight: "700", marginBottom: "3px" });

    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Prompt Name";
    Object.assign(nameLabel.style, { fontWeight: "600", color: "#d8d8d8" });

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = names[index];
    Object.assign(nameInput.style, {
        width: "100%", minHeight: "34px", boxSizing: "border-box", padding: "7px 9px",
        border: "1px solid #606060", borderRadius: "6px", outline: "none",
        background: "#181818", color: "#f0f0f0", font: "13px Arial,sans-serif",
    });

    const typeRow = document.createElement("div");
    Object.assign(typeRow.style, {
        display: "flex", alignItems: "center", gap: "20px", minHeight: "28px",
    });
    const typeInputs = new Map();
    for (const [value, text] of [["prompt", "Prompt"], ["style", "Style"], ["edit", "Edit"], ["llm", "LLM"]]) {
        const label = document.createElement("label");
        Object.assign(label.style, {
            display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer",
        });
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = value === savedType;
        input.dataset.promptType = value;
        input.addEventListener("change", () => {
            if (!input.checked) {
                input.checked = true;
                return;
            }
            for (const otherInput of typeInputs.values()) {
                if (otherInput !== input) otherInput.checked = false;
            }
        });
        const caption = document.createElement("span");
        caption.textContent = text;
        label.append(input, caption);
        typeInputs.set(value, input);
        typeRow.appendChild(label);
    }

    const promptLabel = document.createElement("label");
    promptLabel.textContent = "Prompt";
    Object.assign(promptLabel.style, { fontWeight: "600", color: "#d8d8d8", marginTop: "3px" });

    const promptEditor = document.createElement("textarea");
    promptEditor.value = prompts[index];
    promptEditor.rows = 12;
    promptEditor.spellcheck = false;
    Object.assign(promptEditor.style, {
        width: "100%", minHeight: "220px", maxHeight: "52vh", resize: "vertical",
        boxSizing: "border-box", padding: "10px", border: "1px solid #606060",
        borderRadius: "6px", outline: "none", background: "#181818", color: "#f0f0f0",
        font: "13px/1.45 monospace", whiteSpace: "pre-wrap",
    });

    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "flex", gap: "8px", marginTop: "3px" });
    const saveButton = makeButton("Save", true);
    const cancelButton = makeButton("Cancel");
    actions.append(saveButton, cancelButton);
    panel.append(title, nameLabel, nameInput, typeRow, promptLabel, promptEditor, actions);
    overlay.append(panel);
    document.body.append(overlay);

    const close = () => {
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.remove();
    };

    const save = () => {
        const currentNames = String(namesWidget.value ?? "").split("\n");
        const currentPrompts = parsePrompts(storageWidget);
        if (index >= currentNames.length) return close();
        while (currentPrompts.length < currentNames.length) currentPrompts.push("");

        currentNames[index] = nameInput.value.replace(/[\r\n]+/g, " ");
        currentPrompts[index] = promptEditor.value;
        const selectedType = [...typeInputs.entries()].find(([, input]) => input.checked)?.[0] ?? "prompt";
        node.properties ??= {};
        node.properties.orexPromptEntries = currentNames.map((name, entryIndex) => ({
            id: typeof savedEntries[entryIndex]?.id === "string" && savedEntries[entryIndex].id
                ? savedEntries[entryIndex].id
                : makeEntryId(),
            name,
            prompt: currentPrompts[entryIndex] ?? "",
            type: entryIndex === index
                ? selectedType
                : (["prompt", "style", "edit", "llm"].includes(savedEntries[entryIndex]?.type)
                    ? savedEntries[entryIndex].type
                    : "prompt"),
        }));
        namesWidget.value = currentNames.join("\n");
        storageWidget.value = JSON.stringify(currentPrompts.slice(0, currentNames.length));
        namesWidget.inputEl.value = namesWidget.value;
        namesWidget.callback?.(namesWidget.value);
        storageWidget.callback?.(storageWidget.value);
        selectWidget.value = index + 1;
        selectWidget.callback?.(selectWidget.value);
        promptWidget.value = promptEditor.value;
        promptWidget.inputEl.value = promptEditor.value;
        promptWidget.callback?.(promptEditor.value);
        node.graph?.setDirtyCanvas(true, true);
        refresh();
        syncFavorite?.(node.properties.orexPromptEntries[index]);
        close();
    };

    function onKeyDown(event) {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
        } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            save();
        }
    }

    saveButton.addEventListener("click", save);
    cancelButton.addEventListener("click", close);
    overlay.addEventListener("mousedown", (event) => {
        if (event.target === overlay) close();
    });
    document.addEventListener("keydown", onKeyDown, true);
    requestAnimationFrame(() => {
        nameInput.focus();
        nameInput.select();
    });
}

app.registerExtension({
    name: "OreX.StringSelectorV2",
    async nodeCreated(node) {
        if (node.comfyClass !== NODE_CLASS) return;

        setTimeout(() => {
            const namesWidget = node.widgets?.find((widget) => widget.name === "prompt_names");
            const promptWidget = node.widgets?.find((widget) => widget.name === "prompt");
            const storageWidget = node.widgets?.find((widget) => widget.name === "prompts_json");
            const selectWidget = node.widgets?.find((widget) => widget.name === "select");
            const namesArea = namesWidget?.inputEl;
            const promptArea = promptWidget?.inputEl;
            if (!namesWidget || !promptWidget || !storageWidget || !selectWidget || !namesArea || !promptArea) return;

            storageWidget.computeSize = () => [0, -4];
            storageWidget.draw = () => {};
            if (storageWidget.inputEl) storageWidget.inputEl.style.display = "none";

            namesArea.style.backgroundAttachment = "local";
            namesArea.style.backgroundRepeat = "no-repeat";
            namesArea.style.whiteSpace = "pre";
            namesArea.style.overflowX = "auto";
            namesArea.style.paddingRight = "108px";
            namesArea.style.boxSizing = "border-box";

            promptArea.wrap = "soft";
            promptArea.style.whiteSpace = "pre-wrap";
            promptArea.style.overflowWrap = "anywhere";
            promptArea.style.wordBreak = "break-word";
            promptArea.style.overflowX = "hidden";

            node.properties ??= {};
            if (!Number.isFinite(node.properties.orexSplitterRatio)) {
                node.properties.orexSplitterRatio = 0.75;
            }
            const favoriteIds = new Set();
            let favoriteEntries = [];
            const validTabs = ["custom", "prompt", "style", "edit", "llm"];
            let activeTab = validTabs.includes(node.properties.orexActiveTab)
                ? node.properties.orexActiveTab
                : "custom";
            let switchTab = () => {};
            const replaceFavoriteEntries = (favorites) => {
                favoriteIds.clear();
                favoriteEntries = [];
                for (const favorite of Array.isArray(favorites) ? favorites : []) {
                    if (typeof favorite?.id !== "string" || !favorite.id) continue;
                    favoriteEntries.push({
                        id: favorite.id,
                        name: String(favorite.name ?? ""),
                        prompt: String(favorite.prompt ?? ""),
                        type: ["prompt", "style", "edit", "llm"].includes(favorite.type) ? favorite.type : "prompt",
                    });
                    favoriteIds.add(favorite.id);
                }
            };

            const tabs = document.createElement("div");
            Object.assign(tabs.style, {
                width: "100%", height: "30px", display: "flex", gap: "4px",
                alignItems: "stretch", boxSizing: "border-box",
            });
            const tabButtons = new Map();
            for (const [tab, text] of [["custom", "Custom"], ["prompt", "Prompt"], ["style", "Style"], ["edit", "Edit"], ["llm", "LLM"]]) {
                const tabButton = document.createElement("button");
                tabButton.type = "button";
                tabButton.textContent = text;
                Object.assign(tabButton.style, {
                    flex: "1 1 0", minWidth: "0", border: "1px solid #555",
                    borderRadius: "5px", color: "#ccc", background: "#292929",
                    cursor: "pointer", font: "12px Arial,sans-serif",
                });
                tabButton.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    switchTab(tab);
                });
                tabs.appendChild(tabButton);
                tabButtons.set(tab, tabButton);
            }

            const backupButton = document.createElement("button");
            backupButton.type = "button";
            backupButton.textContent = "Backup";
            Object.assign(backupButton.style, {
                flex: "0 0 72px", minWidth: "0", border: "1px solid #55a9d4",
                borderRadius: "5px", color: "#fff", background: "#247eae",
                cursor: "pointer", font: "600 12px Arial,sans-serif",
            });
            backupButton.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                saveSystemPromptBackup(backupButton);
            });
            tabs.appendChild(backupButton);

            const tabsWidget = node.addDOMWidget("orex_tabs", "orex_tabs", tabs, {
                serialize: false,
                hideOnZoom: false,
                getMinHeight: () => 30,
                getMaxHeight: () => 30,
            });
            const tabsWidgetIndex = node.widgets.indexOf(tabsWidget);
            const namesWidgetIndex = node.widgets.indexOf(namesWidget);
            node.widgets.splice(tabsWidgetIndex, 1);
            node.widgets.splice(namesWidgetIndex, 0, tabsWidget);

            const splitterRatio = () => Math.min(0.85, Math.max(0.15, node.properties.orexSplitterRatio));
            const textFieldsHeight = () => Math.max(160, node.size[1] - 166);
            const namesHeight = () => textFieldsHeight() * splitterRatio();
            const promptHeight = () => textFieldsHeight() * (1 - splitterRatio());
            namesWidget.options.getMinHeight = namesHeight;
            namesWidget.options.getMaxHeight = namesHeight;
            promptWidget.options.getMinHeight = promptHeight;
            promptWidget.options.getMaxHeight = promptHeight;

            const splitter = document.createElement("div");
            splitter.title = "Drag to resize prompt fields";
            Object.assign(splitter.style, {
                width: "100%",
                height: "12px",
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                cursor: "row-resize",
                touchAction: "none",
                userSelect: "none",
            });

            const splitterLine = document.createElement("div");
            Object.assign(splitterLine.style, {
                width: "100%",
                height: "4px",
                borderRadius: "2px",
                background: "#555",
                transition: "background .12s ease",
            });
            splitter.appendChild(splitterLine);

            const splitterWidget = node.addDOMWidget("orex_splitter", "orex_splitter", splitter, {
                serialize: false,
                hideOnZoom: false,
                getMinHeight: () => 12,
                getMaxHeight: () => 12,
            });
            const splitterWidgetIndex = node.widgets.indexOf(splitterWidget);
            const promptWidgetIndex = node.widgets.indexOf(promptWidget);
            node.widgets.splice(splitterWidgetIndex, 1);
            node.widgets.splice(promptWidgetIndex, 0, splitterWidget);

            let dragStartY = 0;
            let dragStartNamesHeight = 0;
            let dragTotalHeight = 0;

            splitter.addEventListener("pointerenter", () => {
                splitterLine.style.background = "#888";
            });
            splitter.addEventListener("pointerleave", () => {
                if (!splitter.hasPointerCapture?.(activePointerId)) splitterLine.style.background = "#555";
            });

            let activePointerId = null;
            splitter.addEventListener("pointerdown", (event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                activePointerId = event.pointerId;
                dragStartY = event.clientY;
                dragStartNamesHeight = namesArea.getBoundingClientRect().height;
                dragTotalHeight = dragStartNamesHeight + promptArea.getBoundingClientRect().height;
                splitter.setPointerCapture(event.pointerId);
                splitterLine.style.background = "#aaa";
            });

            splitter.addEventListener("pointermove", (event) => {
                if (event.pointerId !== activePointerId || dragTotalHeight <= 0) return;
                event.preventDefault();
                event.stopPropagation();
                const nextRatio = (dragStartNamesHeight + event.clientY - dragStartY) / dragTotalHeight;
                node.properties.orexSplitterRatio = Math.min(0.85, Math.max(0.15, nextRatio));
                node.graph?.setDirtyCanvas(true, true);
            });

            const finishSplitterDrag = (event) => {
                if (event.pointerId !== activePointerId) return;
                event.preventDefault();
                event.stopPropagation();
                splitter.releasePointerCapture?.(event.pointerId);
                activePointerId = null;
                splitterLine.style.background = "#888";
                node.graph?.setDirtyCanvas(true, true);
            };
            splitter.addEventListener("pointerup", finishSplitterDrag);
            splitter.addEventListener("pointercancel", finishSplitterDrag);

            const computed = window.getComputedStyle(namesArea);
            const fontSize = parseFloat(computed.fontSize) || 12;
            namesArea.style.lineHeight = `${Math.round(fontSize * 1.4 * 100) / 100}px`;

            let syncing = false;

            const names = () => String(namesWidget.value ?? "").split("\n");
            const customEntries = () => Array.isArray(node.properties.orexPromptEntries)
                ? node.properties.orexPromptEntries
                : [];
            const currentEntries = () => activeTab === "custom"
                ? customEntries()
                : favoriteEntries.filter((entry) => entry.type === activeTab);
            const persistEntries = (list, prompts) => {
                if (activeTab !== "custom") return;
                const previousEntries = Array.isArray(node.properties.orexPromptEntries)
                    ? node.properties.orexPromptEntries
                    : [];
                node.properties.orexPromptEntries = list.map((name, index) => ({
                    id: typeof previousEntries[index]?.id === "string" && previousEntries[index].id
                        ? previousEntries[index].id
                        : makeEntryId(),
                    name,
                    prompt: prompts[index] ?? "",
                    type: ["prompt", "style", "edit", "llm"].includes(previousEntries[index]?.type)
                        ? previousEntries[index].type
                        : "prompt",
                }));
            };

            const restoreEntries = () => {
                const entries = node.properties.orexPromptEntries;
                if (!Array.isArray(entries)) return false;

                const restoredNames = entries.map((entry) => String(entry?.name ?? ""));
                const restoredPrompts = entries.map((entry) => String(entry?.prompt ?? ""));
                node.properties.orexPromptEntries = entries.map((entry, index) => ({
                    id: typeof entry?.id === "string" && entry.id ? entry.id : makeEntryId(),
                    name: restoredNames[index],
                    prompt: restoredPrompts[index],
                    type: ["prompt", "style", "edit", "llm"].includes(entry?.type) ? entry.type : "prompt",
                }));
                const namesText = restoredNames.join("\n");
                const promptsText = JSON.stringify(restoredPrompts);

                if (namesWidget.options?.setValue) namesWidget.options.setValue(namesText);
                else namesWidget.value = namesText;
                namesArea.value = namesText;

                if (storageWidget.options?.setValue) storageWidget.options.setValue(promptsText);
                else storageWidget.value = promptsText;
                if (storageWidget.inputEl) storageWidget.inputEl.value = promptsText;
                return true;
            };

            const normalizeStorage = () => {
                const list = names();
                const prompts = parsePrompts(storageWidget);
                while (prompts.length < list.length) prompts.push("");
                prompts.length = list.length;
                storageWidget.value = JSON.stringify(prompts);
                if (storageWidget.inputEl) storageWidget.inputEl.value = storageWidget.value;
                storageWidget.callback?.(storageWidget.value);
                persistEntries(list, prompts);
                return prompts;
            };

            const selectedIndex = () => {
                const list = names();
                if (!String(namesWidget.value ?? "").trim() || !list.length) return -1;
                return Math.max(0, (Number(selectWidget.value) || 1) - 1) % list.length;
            };

            const lineMetrics = () => {
                const style = window.getComputedStyle(namesArea);
                return {
                    lineHeight: parseFloat(style.lineHeight),
                    paddingTop: parseFloat(style.paddingTop) || 0,
                };
            };

            const tagsLayer = document.createElement("div");
            Object.assign(tagsLayer.style, {
                position: "absolute", zIndex: "2", overflow: "hidden", pointerEvents: "none",
            });
            namesArea.parentElement.appendChild(tagsLayer);

            const dropMarker = document.createElement("div");
            Object.assign(dropMarker.style, {
                position: "absolute", zIndex: "3", height: "3px", borderRadius: "2px",
                background: "#ff9f2f", boxShadow: "0 0 5px rgba(255,159,47,.8)",
                pointerEvents: "none", display: "none",
            });
            namesArea.parentElement.appendChild(dropMarker);

            const syncFavoriteEntry = async (entry) => {
                if (!entry?.id || !favoriteIds.has(entry.id)) return;
                try {
                    await updateFavorite("add", entry);
                    const existingIndex = favoriteEntries.findIndex((favorite) => favorite.id === entry.id);
                    if (existingIndex >= 0) favoriteEntries[existingIndex] = { ...entry };
                    else favoriteEntries.push({ ...entry });
                } catch (error) {
                    console.error("[OreX StringSelector v2] Failed to update favorite", error);
                }
            };

            const toggleFavorite = async (entry, control) => {
                if (!entry?.id || control.disabled) return false;
                control.disabled = true;
                const wasFavorite = favoriteIds.has(entry.id);
                try {
                    const result = await updateFavorite(wasFavorite ? "remove" : "add", entry);
                    if (result.favorite) {
                        favoriteIds.add(entry.id);
                        const existingIndex = favoriteEntries.findIndex((favorite) => favorite.id === entry.id);
                        if (existingIndex >= 0) favoriteEntries[existingIndex] = { ...entry };
                        else favoriteEntries.push({ ...entry });
                    } else {
                        favoriteIds.delete(entry.id);
                        favoriteEntries = favoriteEntries.filter((favorite) => favorite.id !== entry.id);
                    }
                    if (activeTab === "custom") renderTypeLabels();
                    else switchTab(activeTab, true);
                    return true;
                } catch (error) {
                    console.error("[OreX StringSelector v2] Failed to change favorite", error);
                    control.disabled = false;
                    return false;
                }
            };

            let closeDeleteConfirmation = null;
            const openDeleteConfirmation = (entry, control) => {
                closeDeleteConfirmation?.();

                const overlay = document.createElement("div");
                overlay.dataset.orexDeletePrompt = String(node.id);
                Object.assign(overlay.style, {
                    position: "fixed", inset: "0", zIndex: "100001", display: "flex",
                    alignItems: "center", justifyContent: "center", padding: "24px",
                    boxSizing: "border-box", background: "rgba(0,0,0,.62)", pointerEvents: "auto",
                });

                const panel = document.createElement("div");
                Object.assign(panel.style, {
                    width: "min(440px,86vw)", display: "flex", flexDirection: "column",
                    gap: "16px", padding: "18px", boxSizing: "border-box",
                    border: "1px solid #666", borderRadius: "10px", background: "#292929",
                    boxShadow: "0 18px 60px rgba(0,0,0,.55)", color: "#eee",
                    font: "14px Arial,sans-serif",
                });

                const message = document.createElement("div");
                message.textContent = "Are you sure you want to delete the prompt?";

                const actions = document.createElement("div");
                Object.assign(actions.style, { display: "flex", gap: "8px" });
                const okButton = makeButton("OK");
                Object.assign(okButton.style, {
                    background: "#a92f2f", borderColor: "#d05252", color: "#fff",
                });
                const cancelButton = makeButton("Cancel");
                Object.assign(cancelButton.style, {
                    background: "#4a4a4a", borderColor: "#707070", color: "#fff",
                });
                actions.append(okButton, cancelButton);
                panel.append(message, actions);
                overlay.appendChild(panel);
                document.body.appendChild(overlay);

                const close = () => {
                    document.removeEventListener("keydown", onKeyDown, true);
                    overlay.remove();
                    closeDeleteConfirmation = null;
                };
                closeDeleteConfirmation = close;
                const confirm = async () => {
                    okButton.disabled = true;
                    cancelButton.disabled = true;
                    if (await toggleFavorite(entry, control)) close();
                    else {
                        okButton.disabled = false;
                        cancelButton.disabled = false;
                    }
                };
                function onKeyDown(event) {
                    if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        close();
                    }
                }

                okButton.addEventListener("click", confirm);
                cancelButton.addEventListener("click", close);
                overlay.addEventListener("mousedown", (event) => {
                    if (event.target === overlay) close();
                });
                document.addEventListener("keydown", onKeyDown, true);
                requestAnimationFrame(() => cancelButton.focus());
            };

            const renderTypeLabels = () => {
                if (!document.body.contains(namesArea)) return;
                const entries = currentEntries();
                const list = names();
                const { lineHeight, paddingTop } = lineMetrics();
                Object.assign(tagsLayer.style, {
                    left: `${namesArea.offsetLeft}px`,
                    top: `${namesArea.offsetTop}px`,
                    width: `${namesArea.offsetWidth}px`,
                    height: `${namesArea.offsetHeight}px`,
                });
                tagsLayer.replaceChildren();

                for (let index = 0; index < list.length; index++) {
                    const top = paddingTop + index * lineHeight - namesArea.scrollTop;
                    if (top + lineHeight < 0 || top > namesArea.clientHeight) continue;
                    const type = ["prompt", "style", "edit", "llm"].includes(entries[index]?.type)
                        ? entries[index].type
                        : "prompt";
                    const label = document.createElement("span");
                    label.textContent = type;
                    Object.assign(label.style, {
                        position: "absolute", right: "33px", top: `${top}px`,
                        font: window.getComputedStyle(namesArea).font,
                        height: `${lineHeight}px`, lineHeight: `${lineHeight}px`,
                        minWidth: "52px", paddingLeft: "7px", textAlign: "right",
                        boxSizing: "border-box", background: "#222", color: "#48d56a",
                    });
                    tagsLayer.appendChild(label);

                    const entry = entries[index];
                    const actionButton = document.createElement("button");
                    actionButton.type = "button";
                    const isCustom = activeTab === "custom";
                    const isFavorite = Boolean(entry?.id && favoriteIds.has(entry.id));
                    actionButton.textContent = isCustom ? (isFavorite ? "♥" : "♡") : "🗑";
                    actionButton.title = isCustom
                        ? (isFavorite ? "Remove from favorites" : "Add to favorites")
                        : "Delete prompt";
                    Object.assign(actionButton.style, {
                        position: "absolute", right: "5px", top: `${top}px`,
                        width: "25px", height: `${lineHeight}px`, padding: "0", border: "0",
                        background: "transparent",
                        color: isCustom ? (isFavorite ? "#ff3b3b" : "#b8b8b8") : "#ff3b3b",
                        font: `bold ${Math.max(14, lineHeight - 1)}px/${lineHeight}px "Segoe UI Symbol",Arial,sans-serif`,
                        cursor: "pointer", pointerEvents: "auto",
                    });
                    actionButton.addEventListener("pointerdown", (event) => event.stopPropagation());
                    actionButton.addEventListener("click", (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (isCustom) toggleFavorite(entry, actionButton);
                        else openDeleteConfirmation(entry, actionButton);
                    });
                    tagsLayer.appendChild(actionButton);
                }
            };

            fetch(FAVORITES_URL)
                .then((response) => {
                    if (!response.ok) throw new Error(String(response.status));
                    return response.json();
                })
                .then((favorites) => {
                    replaceFavoriteEntries(favorites);
                    switchTab(activeTab, true);
                })
                .catch((error) => console.error("[OreX StringSelector v2] Failed to load favorites", error));

            const tagsResizeObserver = new ResizeObserver(renderTypeLabels);
            tagsResizeObserver.observe(namesArea);
            namesArea.addEventListener("scroll", renderTypeLabels);

            const updateHighlight = () => {
                const index = selectedIndex();
                if (index < 0) {
                    namesArea.style.backgroundImage = "none";
                    renderTypeLabels();
                    return;
                }
                const { lineHeight, paddingTop } = lineMetrics();
                const startY = paddingTop + index * lineHeight;
                namesArea.style.backgroundImage = "linear-gradient(rgba(0,200,50,.35),rgba(0,200,50,.35))";
                namesArea.style.backgroundSize = `100% ${lineHeight}px`;
                namesArea.style.backgroundPosition = `0 ${startY}px`;
                renderTypeLabels();
            };

            const refreshPrompt = () => {
                if (syncing) return;
                syncing = true;
                const prompts = normalizeStorage();
                const index = selectedIndex();
                const value = index >= 0 ? prompts[index] ?? "" : "";
                promptWidget.value = value;
                promptArea.value = value;
                promptWidget.callback?.(value);
                updateHighlight();
                syncing = false;
            };

            const saveVisiblePrompt = () => {
                if (syncing) return;
                if (activeTab !== "custom") return;
                const index = selectedIndex();
                if (index < 0) return;
                const prompts = normalizeStorage();
                prompts[index] = String(promptWidget.value ?? "");
                storageWidget.value = JSON.stringify(prompts);
                if (storageWidget.inputEl) storageWidget.inputEl.value = storageWidget.value;
                storageWidget.callback?.(storageWidget.value);
                persistEntries(names(), prompts);
                node.graph?.setDirtyCanvas(true, true);
            };

            switchTab = (tab, force = false) => {
                if (!validTabs.includes(tab) || (!force && tab === activeTab)) return;
                if (!force && activeTab === "custom") normalizeStorage();

                activeTab = tab;
                node.properties.orexActiveTab = tab;
                const entries = currentEntries();
                const namesText = entries.map((entry) => String(entry.name ?? "")).join("\n");
                const promptsText = JSON.stringify(entries.map((entry) => String(entry.prompt ?? "")));

                syncing = true;
                if (namesWidget.options?.setValue) namesWidget.options.setValue(namesText);
                else namesWidget.value = namesText;
                namesArea.value = namesText;
                if (storageWidget.options?.setValue) storageWidget.options.setValue(promptsText);
                else storageWidget.value = promptsText;
                if (storageWidget.inputEl) storageWidget.inputEl.value = promptsText;
                selectWidget.value = 1;
                namesArea.readOnly = tab !== "custom";
                promptArea.readOnly = tab !== "custom";
                for (const [buttonTab, button] of tabButtons) {
                    const selected = buttonTab === tab;
                    button.style.background = selected ? "#28773a" : "#292929";
                    button.style.borderColor = selected ? "#43a85b" : "#555";
                    button.style.color = selected ? "#fff" : "#ccc";
                }
                syncing = false;
                refreshPrompt();
                node.graph?.setDirtyCanvas(true, true);
            };

            const lineIndexFromEvent = (event) => {
                const list = names();
                if (!String(namesWidget.value ?? "").trim()) return -1;
                const rect = namesArea.getBoundingClientRect();
                const scaleY = namesArea.offsetHeight > 0 ? rect.height / namesArea.offsetHeight : 1;
                const { lineHeight, paddingTop } = lineMetrics();
                const localY = (event.clientY - rect.top) / scaleY + namesArea.scrollTop;
                const index = Math.floor((localY - paddingTop) / lineHeight);
                return index >= 0 && index < list.length ? index : -1;
            };

            let dragState = null;
            let suppressNameClick = false;

            const showDropMarker = (index) => {
                if (index < 0) {
                    dropMarker.style.display = "none";
                    return;
                }
                const { lineHeight, paddingTop } = lineMetrics();
                Object.assign(dropMarker.style, {
                    display: "block",
                    left: `${namesArea.offsetLeft + 3}px`,
                    top: `${namesArea.offsetTop + paddingTop + index * lineHeight - namesArea.scrollTop}px`,
                    width: `${Math.max(0, namesArea.offsetWidth - 6)}px`,
                });
            };

            namesArea.addEventListener("pointerdown", (event) => {
                if (event.button !== 0) return;
                const sourceIndex = lineIndexFromEvent(event);
                if (sourceIndex < 0) return;
                dragState = {
                    pointerId: event.pointerId,
                    sourceIndex,
                    targetIndex: sourceIndex,
                    startX: event.clientX,
                    startY: event.clientY,
                    dragging: false,
                };
            });

            const onPromptDragMove = (event) => {
                if (!dragState || event.pointerId !== dragState.pointerId) return;
                if (!dragState.dragging) {
                    const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
                    if (distance < 5) return;
                    dragState.dragging = true;
                    namesArea.style.cursor = "grabbing";
                }
                event.preventDefault();
                const targetIndex = lineIndexFromEvent(event);
                dragState.targetIndex = targetIndex;
                showDropMarker(targetIndex);
            };
            document.addEventListener("pointermove", onPromptDragMove, { passive: false });

            const onPromptDragEnd = async (event) => {
                if (!dragState || event.pointerId !== dragState.pointerId) return;
                const finishedDrag = dragState;
                dragState = null;
                namesArea.style.cursor = "";
                dropMarker.style.display = "none";
                if (!finishedDrag.dragging) return;

                suppressNameClick = true;
                setTimeout(() => { suppressNameClick = false; }, 0);
                const entries = [...currentEntries()];
                const source = entries[finishedDrag.sourceIndex];
                const target = entries[finishedDrag.targetIndex];
                if (!source || !target || source.id === target.id) return;

                if (activeTab === "custom") {
                    const sourceIndex = entries.findIndex((entry) => entry.id === source.id);
                    entries.splice(sourceIndex, 1);
                    const targetIndex = entries.findIndex((entry) => entry.id === target.id);
                    entries.splice(targetIndex, 0, source);
                    node.properties.orexPromptEntries = entries;
                    switchTab("custom", true);
                    selectWidget.value = entries.findIndex((entry) => entry.id === source.id) + 1;
                    selectWidget.callback?.(selectWidget.value);
                    node.graph?.setDirtyCanvas(true, true);
                    return;
                }

                try {
                    const result = await reorderFavorite(source.id, target.id);
                    replaceFavoriteEntries(result.favorites);
                    switchTab(activeTab, true);
                    const reordered = currentEntries();
                    selectWidget.value = reordered.findIndex((entry) => entry.id === source.id) + 1;
                    selectWidget.callback?.(selectWidget.value);
                } catch (error) {
                    console.error("[OreX StringSelector v2] Failed to reorder prompts", error);
                }
            };
            document.addEventListener("pointerup", onPromptDragEnd);
            document.addEventListener("pointercancel", onPromptDragEnd);

            const originalNamesCallback = namesWidget.callback;
            namesWidget.callback = function () {
                const result = originalNamesCallback?.apply(this, arguments);
                refreshPrompt();
                return result;
            };

            const originalPromptCallback = promptWidget.callback;
            promptWidget.callback = function () {
                const result = originalPromptCallback?.apply(this, arguments);
                saveVisiblePrompt();
                return result;
            };

            const originalSelectCallback = selectWidget.callback;
            selectWidget.callback = function () {
                const result = originalSelectCallback?.apply(this, arguments);
                refreshPrompt();
                return result;
            };

            const originalOnConfigure = node.onConfigure;
            node.onConfigure = function () {
                const result = originalOnConfigure?.apply(this, arguments);
                setTimeout(() => {
                    restoreEntries();
                    activeTab = validTabs.includes(node.properties.orexActiveTab)
                        ? node.properties.orexActiveTab
                        : "custom";
                    switchTab(activeTab, true);
                }, 50);
                return result;
            };

            namesArea.addEventListener("click", (event) => {
                if (suppressNameClick) return;
                const index = lineIndexFromEvent(event);
                if (index < 0) return;
                selectWidget.value = index + 1;
                selectWidget.callback?.(selectWidget.value);
            });

            namesArea.addEventListener("dblclick", (event) => {
                if (activeTab !== "custom") return;
                const index = lineIndexFromEvent(event);
                if (index < 0) return;
                event.preventDefault();
                event.stopPropagation();
                selectWidget.value = index + 1;
                refreshPrompt();
                openPromptEditor(
                    node,
                    namesWidget,
                    promptWidget,
                    storageWidget,
                    selectWidget,
                    index,
                    refreshPrompt,
                    syncFavoriteEntry,
                );
            });

            const originalOnRemoved = node.onRemoved;
            node.onRemoved = function () {
                tagsResizeObserver.disconnect();
                tagsLayer.remove();
                dropMarker.remove();
                document.removeEventListener("pointermove", onPromptDragMove);
                document.removeEventListener("pointerup", onPromptDragEnd);
                document.removeEventListener("pointercancel", onPromptDragEnd);
                closeDeleteConfirmation?.();
                document.querySelector(`[data-orex-prompt-editor="${node.id}"]`)?.remove();
                return originalOnRemoved?.apply(this, arguments);
            };

            restoreEntries();
            switchTab(activeTab, true);
            node.setSize([Math.max(node.size[0], 540), Math.max(node.size[1], 640)]);
        }, 100);
    },
});
