import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// --- УТИЛИТЫ ДЛЯ ВОЛНОВОГО ГРАФИКА ---
const _audioCtx = { value: null };

function getAudioContext() {
    if (!_audioCtx.value) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        _audioCtx.value = new Ctor();
    }
    return _audioCtx.value;
}

function computePeaks(buffer, buckets) {
    const out = [];
    const channels = Math.min(buffer.numberOfChannels, 2);
    if (!channels || !buffer.length) return out;
    const per = buffer.length / buckets;

    for (let i = 0; i < buckets; i++) {
        let min = 0;
        let max = 0;

        for (let c = 0; c < channels; c++) {
            const data = buffer.getChannelData(c);
            const from = Math.floor(i * per);
            const to = Math.min(data.length, Math.floor((i + 1) * per));
            const stride = Math.max(1, Math.floor((to - from) / 400));

            for (let j = from; j < to; j += stride) {
                const v = data[j];
                if (v > max) max = v;
                if (v < min) min = v;
            }
        }

        out.push({ min, max });
    }

    let globalMax = 0;

    for (let i = 0; i < buckets; i++) {
        if (out[i].max > globalMax) globalMax = out[i].max;
        if (-out[i].min > globalMax) globalMax = -out[i].min;
    }

    if (globalMax > 0.0001) {
        for (let i = 0; i < buckets; i++) {
            out[i].min /= globalMax;
            out[i].max /= globalMax;
        }
    }

    return out;
}


// --- КАСТОМНЫЙ ПЛЕЕР С ПОДДЕРЖКОЙ SCRUBBING ---
class CustomAudioPlayer {
    constructor(ctx) {
        this.ctx = ctx;
        this.buffer = null;
        this.source = null;
        this.scrubSource = null;
        this.startTime = 0;
        this.pausedAt = 0;
        this.playing = false;

        this.ontimeupdate = null;
        this.onended = null;

        this._tick = this._tick.bind(this);
        this.reqId = null;
    }

    setBuffer(buffer) {
        this.pause();
        this.buffer = buffer;
        this.pausedAt = 0;
    }

    get currentTime() {
        if (this.playing) {
            return this.ctx.currentTime - this.startTime;
        }
        return this.pausedAt;
    }

    set currentTime(val) {
        let bounded = Math.max(0, Math.min(val, this.duration));

        if (this.playing) {
            this.pause();
            this.pausedAt = bounded;
            this.play();
        } else {
            this.pausedAt = bounded;
            if (this.ontimeupdate) this.ontimeupdate();
        }
    }

    get duration() {
        return this.buffer ? this.buffer.duration : 0;
    }

    get paused() {
        return !this.playing;
    }

    play() {
        if (!this.buffer || this.playing) return;

        if (this.ctx.state === "suspended") {
            this.ctx.resume();
        }

        this.source = this.ctx.createBufferSource();
        this.source.buffer = this.buffer;
        this.source.connect(this.ctx.destination);

        this.source.onended = () => {
            if (this.playing && this.currentTime >= this.duration - 0.05) {
                this.playing = false;
                this.pausedAt = this.duration;
                cancelAnimationFrame(this.reqId);

                if (this.ontimeupdate) this.ontimeupdate();
                if (this.onended) this.onended();
            }
        };

        this.startTime = this.ctx.currentTime - this.pausedAt;
        this.source.start(0, this.pausedAt);
        this.playing = true;

        this.reqId = requestAnimationFrame(this._tick);
    }

    pause() {
        if (!this.playing) return;

        this.pausedAt = this.currentTime;
        this.playing = false;

        if (this.source) {
            this.source.onended = null;

            try {
                this.source.stop();
            } catch (e) {}

            this.source.disconnect();
            this.source = null;
        }

        cancelAnimationFrame(this.reqId);

        if (this.ontimeupdate) this.ontimeupdate();
    }

    scrub(time, rate) {
        if (!this.buffer) return;

        if (this.ctx.state === "suspended") {
            this.ctx.resume();
        }

        if (this.scrubSource) {
            this.scrubSource.onended = null;

            try {
                this.scrubSource.stop();
            } catch (e) {}

            this.scrubSource.disconnect();
        }

        this.scrubSource = this.ctx.createBufferSource();
        this.scrubSource.buffer = this.buffer;

        const absRate = Math.abs(rate);

        this.scrubSource.playbackRate.value =
            Math.max(0.2, Math.min(absRate, 4.0));

        this.scrubSource.connect(this.ctx.destination);
        this.scrubSource.start(0, time, 0.08);
    }

    _tick() {
        if (this.playing) {
            if (this.ontimeupdate) this.ontimeupdate();
            this.reqId = requestAnimationFrame(this._tick);
        }
    }
}


// --- СВЕРХЧЕТКИЙ PIXEL-PERFECT РЕНДЕР С ПОДДЕРЖКОЙ МАСШТАБА ---
function drawWaveform(
    canvas,
    peaks,
    selFrom,
    selTo,
    accentColor,
    playAt,
    customMarkers,
    duration,
    zoom = 1.0,
    offset = 0.0
) {
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();

    let cssW = rect.width;
    let cssH = rect.height;

    if (cssW === 0 || cssH === 0) {
        cssW = canvas.clientWidth || 300;
        cssH = canvas.clientHeight || 60;
    }

    const dpr = window.devicePixelRatio || 1;
    const physW = Math.max(1, Math.round(cssW * dpr));
    const physH = Math.max(1, Math.round(cssH * dpr));

    if (canvas.width !== physW) canvas.width = physW;
    if (canvas.height !== physH) canvas.height = physH;

    const ctx = canvas.getContext("2d", { alpha: false });

    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = "#151515";
    ctx.fillRect(0, 0, physW, physH);

    const baseW = canvas.clientWidth || 300;
    const renderScale = physW / baseW;

    const s = (val) => Math.round(val * renderScale);

    if (!peaks || !peaks.length) {
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.font = `${s(12)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
            "No audio / Loading...",
            physW / 2,
            physH / 2
        );
        return;
    }

    const n = peaks.length;
    const mid = Math.round(physH / 2);

    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(0, mid, physW, 1);

    const getPx = (ratio) =>
        Math.round(((ratio - offset) / zoom) * physW);

    const isVis = (px) =>
        px >= -100 && px <= physW + 100;

    const drawWaveLines = (color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();

        for (let px = 0; px < physW; px++) {
            const ratioStart =
                (px / physW) * zoom + offset;

            const ratioEnd =
                ((px + 1) / physW) * zoom + offset;

            const startIdx = Math.max(
                0,
                Math.min(
                    n - 1,
                    Math.floor(ratioStart * n)
                )
            );

            const endIdx = Math.max(
                0,
                Math.min(
                    n - 1,
                    Math.floor(ratioEnd * n)
                )
            );

            let pMax = 0;
            let pMin = 0;

            for (let i = startIdx; i <= endIdx; i++) {
                if (peaks[i].max > pMax)
                    pMax = peaks[i].max;

                if (peaks[i].min < pMin)
                    pMin = peaks[i].min;
            }

            if (
                pMax === 0 &&
                pMin === 0 &&
                startIdx < n
            ) {
                pMax = peaks[startIdx].max;
                pMin = peaks[startIdx].min;
            }

            const yTop = Math.round(
                mid - pMax * mid * 0.95
            );

            const yBot = Math.round(
                mid - pMin * mid * 0.95
            );

            ctx.moveTo(px + 0.5, yTop);
            ctx.lineTo(px + 0.5, yBot);
        }

        ctx.stroke();
    };

    drawWaveLines("#555");

    const pxFrom = getPx(selFrom);
    const pxTo = getPx(selTo);

    if (pxTo > pxFrom) {
        ctx.save();

        ctx.beginPath();
        ctx.rect(
            pxFrom,
            0,
            pxTo - pxFrom,
            physH
        );

        ctx.clip();

        ctx.fillStyle =
            "rgba(255,255,255,0.08)";

        ctx.fillRect(
            pxFrom,
            0,
            pxTo - pxFrom,
            physH
        );

        drawWaveLines(accentColor);

        ctx.restore();
    }

    const drawMinus = (px) => {
        ctx.fillStyle = "#007bff";

        ctx.fillRect(
            px - s(4.5),
            physH - s(8),
            s(9),
            s(8)
        );

        ctx.fillStyle = "#fff";

        ctx.fillRect(
            px - s(2),
            physH - s(4.5),
            s(4),
            Math.max(1, s(1.5))
        );
    };

    const drawPlus = (px) => {
        ctx.fillStyle = "#ffcc00";

        ctx.fillRect(
            px - s(3.5),
            physH - s(7),
            s(7),
            s(7)
        );

        ctx.fillStyle = "#000";

        ctx.fillRect(
            px - s(0.5),
            physH - s(5.5),
            Math.max(1, s(1)),
            s(4)
        );

        ctx.fillRect(
            px - s(2),
            physH - s(4),
            s(4),
            Math.max(1, s(1))
        );
    };

    const lineW =
        Math.max(1, Math.round(s(0.5)));

    if (customMarkers && duration > 0) {
        customMarkers.forEach((time) => {
            const px =
                getPx(time / duration);

            if (isVis(px)) {
                ctx.fillStyle = "#ffcc00";

                ctx.fillRect(
                    px - Math.floor(lineW / 2),
                    0,
                    lineW,
                    physH
                );

                drawMinus(px);
            }
        });
    }

    if (pxTo > pxFrom) {
        ctx.fillStyle = "#ffffff";

        if (isVis(pxFrom)) {
            ctx.fillRect(
                pxFrom - Math.floor(lineW / 2),
                0,
                lineW,
                physH
            );

            drawPlus(pxFrom);
        }

        if (isVis(pxTo)) {
            ctx.fillRect(
                pxTo - Math.floor(lineW / 2),
                0,
                lineW,
                physH
            );

            drawPlus(pxTo);
        }
    }

    if (
        playAt != null &&
        playAt >= 0 &&
        playAt <= 1
    ) {
        const px = getPx(playAt);

        if (isVis(px)) {
            ctx.fillStyle = "#ff4444";

            ctx.fillRect(
                px - Math.floor(lineW / 2),
                0,
                lineW,
                physH
            );

            ctx.beginPath();
            ctx.moveTo(px - s(3), 0);
            ctx.lineTo(px + s(3), 0);
            ctx.lineTo(px, s(4));
            ctx.fill();

            drawPlus(px);
        }
    }

    // Красная кнопка Refresh намеренно удалена.
    // Для сброса используется синяя кнопка Reset.
}


const formatTime = (sec) => {
    if (isNaN(sec) || sec < 0)
        return "00:00:00";

    const m =
        Math.floor(sec / 60)
            .toString()
            .padStart(2, "0");

    const s =
        Math.floor(sec % 60)
            .toString()
            .padStart(2, "0");

    const ms =
        sec.toFixed(2).split(".")[1];

    return `${m}:${s}:${ms}`;
};


// --- РЕГИСТРАЦИЯ УЗЛА ---
app.registerExtension({
    name: "OreX.AudioLoad_v2",

    async beforeRegisterNodeDef(
        nodeType,
        nodeData,
        app
    ) {
        if (
            nodeData.name ===
            "orex Audio load v2"
        ) {
            const onNodeCreated =
                nodeType.prototype.onNodeCreated;

            const onExecuted =
                nodeType.prototype.onExecuted;

            nodeType.prototype.onExecuted =
                function (message) {
                    if (onExecuted)
                        onExecuted.apply(
                            this,
                            arguments
                        );

                    if (
                        message?.audio?.length > 0
                    ) {
                        this._trimmedAudioData =
                            message.audio[0];
                    }
                };

            nodeType.prototype.onNodeCreated =
                function () {
                    const r = onNodeCreated
                        ? onNodeCreated.apply(
                              this,
                              arguments
                          )
                        : undefined;

                    const fileWidget =
                        this.widgets.find(
                            (w) =>
                                w.name === "audio"
                        );

                    const startWidget =
                        this.widgets.find(
                            (w) =>
                                w.name ===
                                "start_time"
                        );

                    const endWidget =
                        this.widgets.find(
                            (w) =>
                                w.name ===
                                "end_time"
                        );

                    const normWidget =
                        this.widgets.find(
                            (w) =>
                                w.name ===
                                "normalize_audio"
                        );

                    if (fileWidget) {
                        fileWidget.hidden = true;

                        if (fileWidget.element)
                            fileWidget.element.style.display =
                                "none";
                    }

                    let audioDuration = 0;
                    let currentPeaks = null;

                    const accentColor =
                        "#8ec07c";

                    let customMarkers = [];
                    let savedPresetsData = {};

                    let waveZoom = 1.0;
                    let waveOffset = 0.0;

                    const container =
                        document.createElement(
                            "div"
                        );

                    container.style.WebkitFontSmoothing =
                        "antialiased";

                    container.style.MozOsxFontSmoothing =
                        "grayscale";

                    container.style.display =
                        "flex";

                    container.style.flexDirection =
                        "column";

                    container.style.gap =
                        "6px";

                    container.style.width =
                        "100%";

                    container.style.marginTop =
                        "4px";

                    container.addEventListener(
                        "wheel",
                        (e) => {
                            if (app.canvas) {
                                app.canvas.processMouseWheel(
                                    e
                                );

                                e.stopPropagation();
                                e.preventDefault();
                            }
                        },
                        { capture: true }
                    );

                    const row1 =
                        document.createElement(
                            "div"
                        );

                    row1.style.display =
                        "flex";

                    row1.style.gap = "4px";

                    const fileDisplay =
                        document.createElement(
                            "input"
                        );

                    fileDisplay.type = "text";
                    fileDisplay.readOnly = true;

                    fileDisplay.placeholder =
                        "Select or upload audio...";

                    fileDisplay.style.flexGrow =
                        "1";

                    fileDisplay.style.background =
                        "#1d1d1d";

                    fileDisplay.style.border =
                        "1px solid #444";

                    fileDisplay.style.color =
                        "#ddd";

                    fileDisplay.style.padding =
                        "4px";

                    fileDisplay.style.borderRadius =
                        "4px";

                    const uploadBtn =
                        document.createElement(
                            "button"
                        );

                    uploadBtn.textContent =
                        "Upload";

                    uploadBtn.style.padding =
                        "4px 8px";

                    uploadBtn.style.background =
                        "#333";

                    uploadBtn.style.color =
                        "#ccc";

                    uploadBtn.style.border =
                        "1px solid #555";

                    uploadBtn.style.borderRadius =
                        "4px";

                    uploadBtn.style.cursor =
                        "pointer";

                    const fileInput =
                        document.createElement(
                            "input"
                        );

                    fileInput.type = "file";

                    fileInput.accept =
                        "audio/*,video/*";

                    fileInput.style.display =
                        "none";

                    uploadBtn.onclick = () =>
                        fileInput.click();

                    row1.appendChild(
                        fileDisplay
                    );

                    row1.appendChild(
                        uploadBtn
                    );

                    row1.appendChild(
                        fileInput
                    );

                    const dropZone =
                        document.createElement(
                            "div"
                        );

                    dropZone.innerText =
                        "Put it";

                    dropZone.style.border =
                        "2px dashed #555";

                    dropZone.style.borderRadius =
                        "4px";

                    dropZone.style.textAlign =
                        "center";

                    dropZone.style.padding =
                        "8px";

                    dropZone.style.color =
                        "#aaa";

                    dropZone.style.cursor =
                        "pointer";

                    dropZone.style.transition =
                        "border-color 0.2s ease";

                    dropZone.style.backgroundColor =
                        "rgba(0,0,0,0.2)";

                    dropZone.onclick = () =>
                        fileInput.click();

                    dropZone.ondragover = (
                        e
                    ) => {
                        e.preventDefault();

                        dropZone.style.borderColor =
                            accentColor;
                    };

                    dropZone.ondragleave =
                        () => {
                            dropZone.style.borderColor =
                                "#555";
                        };

                    const markerPresetRow =
                        document.createElement(
                            "div"
                        );

                    markerPresetRow.style.display =
                        "flex";

                    markerPresetRow.style.gap =
                        "4px";

                    const presetSelect =
                        document.createElement(
                            "select"
                        );

                    presetSelect.style.flexGrow =
                        "1";

                    presetSelect.style.background =
                        "#1d1d1d";

                    presetSelect.style.border =
                        "1px solid #444";

                    presetSelect.style.color =
                        "#ddd";

                    presetSelect.style.padding =
                        "4px";

                    presetSelect.style.borderRadius =
                        "4px";

                    presetSelect.style.outline =
                        "none";

                    const saveBtn =
                        document.createElement(
                            "button"
                        );

                    saveBtn.textContent =
                        "Save";

                    saveBtn.style.padding =
                        "4px 8px";

                    saveBtn.style.background =
                        "#2b5c2b";

                    saveBtn.style.color =
                        "#ccc";

                    saveBtn.style.border =
                        "1px solid #444";

                    saveBtn.style.borderRadius =
                        "4px";

                    saveBtn.style.cursor =
                        "pointer";

                    const delBtn =
                        document.createElement(
                            "button"
                        );

                    delBtn.textContent = "Del";

                    delBtn.style.padding =
                        "4px 8px";

                    delBtn.style.background =
                        "#5c2b2b";

                    delBtn.style.color =
                        "#ccc";

                    delBtn.style.border =
                        "1px solid #444";

                    delBtn.style.borderRadius =
                        "4px";

                    delBtn.style.cursor =
                        "pointer";

                    const resetBtn =
                        document.createElement(
                            "button"
                        );

                    resetBtn.textContent =
                        "Reset";

                    resetBtn.style.padding =
                        "4px 8px";

                    resetBtn.style.background =
                        "#2b4a5c";

                    resetBtn.style.color =
                        "#ccc";

                    resetBtn.style.border =
                        "1px solid #444";

                    resetBtn.style.borderRadius =
                        "4px";

                    resetBtn.style.cursor =
                        "pointer";

                    markerPresetRow.appendChild(
                        presetSelect
                    );

                    markerPresetRow.appendChild(
                        saveBtn
                    );

                    markerPresetRow.appendChild(
                        delBtn
                    );

                    markerPresetRow.appendChild(
                        resetBtn
                    );

                    const fetchPresets =
                        async () => {
                            try {
                                const res =
                                    await api.fetchApi(
                                        "/orex/audio_markers"
                                    );

                                savedPresetsData =
                                    await res.json();

                                updatePresetSelect();
                            } catch (e) {
                                console.error(
                                    "[OreX] Error fetching presets",
                                    e
                                );
                            }
                        };

                    const updatePresetSelect = (
                        selectedName = null
                    ) => {
                        presetSelect.innerHTML =
                            '<option value="">-- No preset --</option>';

                        for (const name in savedPresetsData) {
                            const opt =
                                document.createElement(
                                    "option"
                                );

                            opt.value = name;
                            opt.textContent = name;

                            presetSelect.appendChild(
                                opt
                            );
                        }

                        if (
                            selectedName &&
                            savedPresetsData[
                                selectedName
                            ]
                        ) {
                            presetSelect.value =
                                selectedName;
                        }
                    };

                    const applyPreset = (
                        name
                    ) => {
                        if (
                            !name ||
                            !savedPresetsData[
                                name
                            ]
                        )
                            return;

                        const preset =
                            savedPresetsData[
                                name
                            ];

                        if (startWidget)
                            startWidget.value =
                                preset.bounds
                                    ?.start || 0;

                        if (endWidget)
                            endWidget.value =
                                preset.bounds
                                    ?.end || 0;

                        customMarkers = [
                            ...(preset.markers ||
                                []),
                        ];

                        triggerDraw();

                        app.graph.setDirtyCanvas(
                            true,
                            false
                        );
                    };

                    presetSelect.onchange =
                        () => {
                            applyPreset(
                                presetSelect.value
                            );
                        };

                    saveBtn.onclick =
                        async () => {
                            if (
                                !fileDisplay.value
                            ) {
                                alert(
                                    "Сначала загрузите аудио файл."
                                );
                                return;
                            }

                            const presetName =
                                fileDisplay.value;

                            const dataToSave = {
                                name: presetName,

                                markers:
                                    customMarkers,

                                bounds: {
                                    start: startWidget
                                        ? parseFloat(
                                              startWidget.value
                                          )
                                        : 0,

                                    end: endWidget
                                        ? parseFloat(
                                              endWidget.value
                                          )
                                        : 0,
                                },
                            };

                            try {
                                await api.fetchApi(
                                    "/orex/audio_markers/save",
                                    {
                                        method:
                                            "POST",

                                        body: JSON.stringify(
                                            dataToSave
                                        ),
                                    }
                                );

                                await fetchPresets();

                                presetSelect.value =
                                    presetName;
                            } catch (e) {
                                console.error(
                                    "[OreX] Error saving preset",
                                    e
                                );
                            }
                        };

                    delBtn.onclick =
                        async () => {
                            const presetName =
                                presetSelect.value;

                            if (!presetName)
                                return;

                            try {
                                await api.fetchApi(
                                    "/orex/audio_markers/delete",
                                    {
                                        method:
                                            "POST",

                                        body: JSON.stringify(
                                            {
                                                name: presetName,
                                            }
                                        ),
                                    }
                                );

                                await fetchPresets();

                                presetSelect.value =
                                    "";
                            } catch (e) {
                                console.error(
                                    "[OreX] Error deleting preset",
                                    e
                                );
                            }
                        };

                    // Синяя кнопка Reset остаётся
                    resetBtn.onclick = () => {
                        customMarkers = [];

                        triggerDraw();

                        app.graph.setDirtyCanvas(
                            true,
                            false
                        );
                    };

                    const handleFileUpload =
                        async (file) => {
                            const CHUNK_SIZE =
                                5 *
                                1024 *
                                1024;

                            const totalChunks =
                                Math.ceil(
                                    file.size /
                                        CHUNK_SIZE
                                );

                            const filename =
                                file.name;

                            try {
                                dropZone.style.borderColor =
                                    "#555";

                                uploadBtn.style.backgroundColor =
                                    "#444";

                                dropZone.innerText =
                                    "Uploading...";

                                for (
                                    let i = 0;
                                    i <
                                    totalChunks;
                                    i++
                                ) {
                                    const start =
                                        i *
                                        CHUNK_SIZE;

                                    const end =
                                        Math.min(
                                            start +
                                                CHUNK_SIZE,
                                            file.size
                                        );

                                    const chunk =
                                        file.slice(
                                            start,
                                            end
                                        );

                                    const body =
                                        new FormData();

                                    body.append(
                                        "file",
                                        chunk
                                    );

                                    body.append(
                                        "filename",
                                        filename
                                    );

                                    body.append(
                                        "chunk_index",
                                        i
                                    );

                                    body.append(
                                        "total_chunks",
                                        totalChunks
                                    );

                                    const resp =
                                        await api.fetchApi(
                                            "/orex/upload_chunk",
                                            {
                                                method:
                                                    "POST",
                                                body,
                                            }
                                        );

                                    if (
                                        !resp.ok
                                    )
                                        throw new Error(
                                            "Upload failed"
                                        );

                                    const data =
                                        await resp.json();

                                    const pct =
                                        Math.round(
                                            ((i +
                                                1) /
                                                totalChunks) *
                                                100
                                        );

                                    uploadBtn.textContent =
                                        `${pct}%`;

                                    dropZone.innerText =
                                        `Uploading... ${pct}%`;

                                    if (
                                        i ===
                                            totalChunks -
                                                1 &&
                                        data.full_path
                                    ) {
                                        if (
                                            fileWidget
                                        ) {
                                            fileWidget.value =
                                                data.full_path;

                                            fileWidget.callback();
                                        }
                                    }
                                }
                            } catch (error) {
                                console.error(
                                    error
                                );

                                uploadBtn.textContent =
                                    "Error";

                                dropZone.innerText =
                                    "Error! See console";

                                uploadBtn.style.backgroundColor =
                                    "#8b0000";
                            } finally {
                                setTimeout(
                                    () => {
                                        uploadBtn.textContent =
                                            "Upload";

                                        dropZone.innerText =
                                            "Put it";

                                        uploadBtn.style.backgroundColor =
                                            "#333";
                                    },
                                    2000
                                );
                            }
                        };

                    dropZone.ondrop = (
                        e
                    ) => {
                        e.preventDefault();

                        dropZone.style.borderColor =
                            "#555";

                        if (
                            e.dataTransfer
                                .files.length
                        ) {
                            handleFileUpload(
                                e.dataTransfer
                                    .files[0]
                            );
                        }
                    };

                    fileInput.onchange =
                        () => {
                            if (
                                fileInput.files
                                    .length
                            ) {
                                handleFileUpload(
                                    fileInput
                                        .files[0]
                                );
                            }
                        };

                    const waveCanvas =
                        document.createElement(
                            "canvas"
                        );

                    waveCanvas.style.width =
                        "100%";

                    waveCanvas.style.height =
                        "60px";

                    waveCanvas.style.background =
                        "#151515";

                    waveCanvas.style.border =
                        "1px solid #444";

                    waveCanvas.style.borderRadius =
                        "4px";

                    waveCanvas.style.cursor =
                        "pointer";

                    const zoomRow =
                        document.createElement(
                            "div"
                        );

                    zoomRow.style.display =
                        "flex";

                    zoomRow.style.alignItems =
                        "center";

                    zoomRow.style.gap = "4px";

                    const zoomScroll =
                        document.createElement(
                            "input"
                        );

                    zoomScroll.type = "range";
                    zoomScroll.min = 0;
                    zoomScroll.max = 100;
                    zoomScroll.value = 0;
                    zoomScroll.disabled = true;

                    zoomScroll.style.opacity =
                        "0.3";

                    zoomScroll.style.flexGrow =
                        "1";

                    zoomScroll.style.cursor =
                        "pointer";

                    const btnStyle = {
                        padding: "2px 8px",
                        background: "#333",
                        color: "#ccc",
                        border:
                            "1px solid #555",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "bold",
                    };

                    const zoomInBtn =
                        document.createElement(
                            "button"
                        );

                    zoomInBtn.textContent =
                        "+";

                    Object.assign(
                        zoomInBtn.style,
                        btnStyle
                    );

                    const zoomOutBtn =
                        document.createElement(
                            "button"
                        );

                    zoomOutBtn.textContent =
                        "-";

                    Object.assign(
                        zoomOutBtn.style,
                        btnStyle
                    );

                    zoomRow.appendChild(
                        zoomScroll
                    );

                    zoomRow.appendChild(
                        zoomInBtn
                    );

                    zoomRow.appendChild(
                        zoomOutBtn
                    );

                    const updateZoomUI =
                        () => {
                            if (
                                waveZoom >= 1.0
                            ) {
                                waveZoom = 1.0;
                                waveOffset = 0.0;

                                zoomScroll.disabled =
                                    true;

                                zoomScroll.value =
                                    0;

                                zoomScroll.style.opacity =
                                    "0.3";
                            } else {
                                zoomScroll.disabled =
                                    false;

                                zoomScroll.style.opacity =
                                    "1.0";

                                const maxOffset =
                                    1.0 -
                                    waveZoom;

                                zoomScroll.value =
                                    (waveOffset /
                                        maxOffset) *
                                    100;
                            }
                        };

                    zoomInBtn.onclick =
                        () => {
                            if (
                                audioDuration <=
                                0
                            )
                                return;

                            const centerRatio =
                                waveOffset +
                                waveZoom / 2;

                            waveZoom =
                                Math.max(
                                    0.01,
                                    waveZoom *
                                        0.8
                                );

                            waveOffset =
                                Math.max(
                                    0,
                                    Math.min(
                                        centerRatio -
                                            waveZoom /
                                                2,
                                        1.0 -
                                            waveZoom
                                    )
                                );

                            updateZoomUI();
                            triggerDraw();
                        };

                    zoomOutBtn.onclick =
                        () => {
                            if (
                                audioDuration <=
                                0
                            )
                                return;

                            const centerRatio =
                                waveOffset +
                                waveZoom / 2;

                            waveZoom =
                                Math.min(
                                    1.0,
                                    waveZoom /
                                        0.8
                                );

                            waveOffset =
                                Math.max(
                                    0,
                                    Math.min(
                                        centerRatio -
                                            waveZoom /
                                                2,
                                        1.0 -
                                            waveZoom
                                    )
                                );

                            updateZoomUI();
                            triggerDraw();
                        };

                    zoomScroll.oninput = (
                        e
                    ) => {
                        if (
                            waveZoom >= 1.0
                        )
                            return;

                        const maxOffset =
                            1.0 -
                            waveZoom;

                        waveOffset =
                            (e.target.value /
                                100) *
                            maxOffset;

                        triggerDraw();
                    };

                    const playerContainer =
                        document.createElement(
                            "div"
                        );

                    playerContainer.style.display =
                        "flex";

                    playerContainer.style.alignItems =
                        "center";

                    playerContainer.style.gap =
                        "8px";

                    playerContainer.style.padding =
                        "6px 10px";

                    playerContainer.style.backgroundColor =
                        "rgba(0,0,0,0.4)";

                    playerContainer.style.borderRadius =
                        "4px";

                    playerContainer.style.color =
                        "#ccc";

                    playerContainer.style.fontFamily =
                        "sans-serif";

                    playerContainer.style.fontSize =
                        "12px";

                    const playBtn =
                        document.createElement(
                            "button"
                        );

                    playBtn.innerHTML = "▶";

                    playBtn.style.background =
                        "none";

                    playBtn.style.border =
                        "none";

                    playBtn.style.color =
                        "#fff";

                    playBtn.style.cursor =
                        "pointer";

                    playBtn.style.fontSize =
                        "16px";

                    playBtn.style.padding =
                        "0";

                    const timeDisplay =
                        document.createElement(
                            "span"
                        );

                    timeDisplay.innerText =
                        "00:00:00 / 00:00:00";

                    timeDisplay.style.minWidth =
                        "120px";

                    timeDisplay.style.textAlign =
                        "center";

                    timeDisplay.style.fontFamily =
                        "monospace";

                    const seekBar =
                        document.createElement(
                            "input"
                        );

                    seekBar.type = "range";
                    seekBar.min = 0;
                    seekBar.max = 100;
                    seekBar.value = 0;

                    seekBar.style.flexGrow =
                        "1";

                    seekBar.style.cursor =
                        "pointer";

                    const menuBtn =
                        document.createElement(
                            "div"
                        );

                    menuBtn.innerHTML =
                        "&#8942;";

                    menuBtn.style.cursor =
                        "pointer";

                    menuBtn.style.fontSize =
                        "18px";

                    menuBtn.style.padding =
                        "0 4px";

                    menuBtn.style.userSelect =
                        "none";

                    const audioEl =
                        new CustomAudioPlayer(
                            getAudioContext()
                        );

                    playerContainer.appendChild(
                        playBtn
                    );

                    playerContainer.appendChild(
                        timeDisplay
                    );

                    playerContainer.appendChild(
                        seekBar
                    );

                    playerContainer.appendChild(
                        menuBtn
                    );

                    container.appendChild(
                        row1
                    );

                    container.appendChild(
                        dropZone
                    );

                    container.appendChild(
                        markerPresetRow
                    );

                    container.appendChild(
                        waveCanvas
                    );

                    container.appendChild(
                        zoomRow
                    );

                    container.appendChild(
                        playerContainer
                    );

                    const domWidget =
                        this.addDOMWidget(
                            "orex_ui",
                            "div",
                            container,
                            {
                                serialize:
                                    false,
                                hideOnZoom:
                                    false,
                            }
                        );

                    domWidget.computeSize =
                        function () {
                            return [
                                200,
                                255,
                            ];
                        };

                    this.size = [
                        380,
                        345,
                    ];

                    const uiIdx =
                        this.widgets.indexOf(
                            domWidget
                        );

                    if (uiIdx > -1) {
                        this.widgets.splice(
                            uiIdx,
                            1
                        );

                        this.widgets.unshift(
                            domWidget
                        );
                    }

                    fetchPresets();

                    const getTrimmedBounds =
                        () => {
                            let s =
                                startWidget
                                    ? parseFloat(
                                          startWidget.value
                                      ) || 0
                                    : 0;

                            let e =
                                endWidget
                                    ? parseFloat(
                                          endWidget.value
                                      ) || 0
                                    : 0;

                            if (
                                e <= 0 ||
                                e >
                                    audioDuration
                            )
                                e =
                                    audioDuration;

                            if (s > e)
                                s = e;

                            return {
                                start:
                                    Math.max(
                                        0,
                                        s
                                    ),

                                end: e,

                                duration:
                                    e -
                                    Math.max(
                                        0,
                                        s
                                    ),
                            };
                        };

                    let isDraggingSeek =
                        false;

                    const updatePlayerUI =
                        () => {
                            const bounds =
                                getTrimmedBounds();

                            const currentRel =
                                Math.max(
                                    0,
                                    audioEl.currentTime -
                                        bounds.start
                                );

                            timeDisplay.innerText =
                                `${formatTime(
                                    currentRel
                                )} / ${formatTime(
                                    bounds.duration
                                )}`;

                            if (
                                !isDraggingSeek
                            ) {
                                const progress =
                                    bounds.duration >
                                    0
                                        ? (currentRel /
                                              bounds.duration) *
                                          100
                                        : 0;

                                seekBar.value =
                                    isNaN(
                                        progress
                                    )
                                        ? 0
                                        : progress;
                            }

                            if (
                                audioEl.playing &&
                                !isDraggingSeek
                            ) {
                                const currRatio =
                                    audioEl.currentTime /
                                    audioDuration;

                                if (
                                    currRatio <
                                        waveOffset ||
                                    currRatio >
                                        waveOffset +
                                            waveZoom
                                ) {
                                    waveOffset =
                                        Math.max(
                                            0,
                                            Math.min(
                                                currRatio -
                                                    waveZoom /
                                                        2,
                                                1.0 -
                                                    waveZoom
                                            )
                                        );

                                    updateZoomUI();
                                }
                            }
                        };

                    const triggerDraw =
                        () => {
                            const bounds =
                                getTrimmedBounds();

                            const sPct =
                                audioDuration >
                                0
                                    ? bounds.start /
                                      audioDuration
                                    : 0;

                            const ePct =
                                audioDuration >
                                0
                                    ? bounds.end /
                                      audioDuration
                                    : 1;

                            const pPct =
                                audioDuration >
                                0
                                    ? audioEl.currentTime /
                                      audioDuration
                                    : null;

                            drawWaveform(
                                waveCanvas,
                                currentPeaks,
                                sPct,
                                ePct,
                                accentColor,
                                pPct,
                                customMarkers,
                                audioDuration,
                                waveZoom,
                                waveOffset
                            );

                            updatePlayerUI();
                        };

                    seekBar.onmousedown =
                        () => {
                            isDraggingSeek =
                                true;
                        };

                    seekBar.onmouseup =
                        () => {
                            isDraggingSeek =
                                false;
                        };

                    seekBar.oninput = (
                        e
                    ) => {
                        const bounds =
                            getTrimmedBounds();

                        audioEl.currentTime =
                            bounds.start +
                            (e.target.value /
                                100) *
                                bounds.duration;

                        updatePlayerUI();
                        triggerDraw();
                    };

                    const getLogicalPx = (
                        time
                    ) => {
                        const baseW =
                            waveCanvas.clientWidth ||
                            300;

                        return (
                            ((time /
                                audioDuration -
                                waveOffset) /
                                waveZoom) *
                            baseW
                        );
                    };

                    waveCanvas.addEventListener(
                        "pointerdown",
                        (e) => {
                            if (
                                audioDuration <=
                                0
                            )
                                return;

                            const rect =
                                waveCanvas.getBoundingClientRect();

                            const cx =
                                e.clientX -
                                rect.left;

                            const cy =
                                e.clientY -
                                rect.top;

                            const clickRatio =
                                (cx /
                                    rect.width) *
                                    waveZoom +
                                waveOffset;

                            const clickTime =
                                clickRatio *
                                audioDuration;

                            const bounds =
                                getTrimmedBounds();

                            const baseW =
                                waveCanvas.clientWidth ||
                                300;

                            const baseH =
                                waveCanvas.clientHeight ||
                                60;

                            const nx =
                                (cx /
                                    rect.width) *
                                baseW;

                            const ny =
                                (cy /
                                    rect.height) *
                                baseH;

                            const pNx =
                                getLogicalPx(
                                    audioEl.currentTime
                                );

                            if (
                                ny <= 20 &&
                                Math.abs(
                                    nx - pNx
                                ) <= 15
                            ) {
                                const now =
                                    Date.now();

                                if (
                                    now -
                                        (waveCanvas._lastPlayheadClick ||
                                            0) <
                                    300
                                ) {
                                    waveCanvas._lastPlayheadClick =
                                        0;

                                    if (
                                        audioEl.paused
                                    ) {
                                        if (
                                            audioEl.currentTime >=
                                            bounds.end
                                        )
                                            audioEl.currentTime =
                                                bounds.start;

                                        audioEl.play();

                                        playBtn.innerHTML =
                                            "⏸";
                                    } else {
                                        audioEl.pause();

                                        playBtn.innerHTML =
                                            "▶";
                                    }

                                    triggerDraw();

                                    return;
                                }

                                waveCanvas._lastPlayheadClick =
                                    now;

                                waveCanvas._lastScrubTime =
                                    performance.now();

                                waveCanvas._lastScrubVal =
                                    audioEl.currentTime;

                                try {
                                    waveCanvas.setPointerCapture(
                                        e.pointerId
                                    );
                                } catch (x) {}

                                const scrubMove =
                                    (mv) => {
                                        if (
                                            !(
                                                mv.buttons &
                                                1
                                            )
                                        ) {
                                            scrubCleanup();
                                            return;
                                        }

                                        const mx =
                                            Math.max(
                                                0,
                                                Math.min(
                                                    mv.clientX -
                                                        rect.left,
                                                    rect.width
                                                )
                                            );

                                        const valRatio =
                                            (mx /
                                                rect.width) *
                                                waveZoom +
                                            waveOffset;

                                        const val =
                                            Math.max(
                                                0,
                                                Math.min(
                                                    valRatio *
                                                        audioDuration,
                                                    audioDuration
                                                )
                                            );

                                        audioEl.currentTime =
                                            val;

                                        const pnow =
                                            performance.now();

                                        const dr =
                                            (pnow -
                                                waveCanvas._lastScrubTime) /
                                            1000;

                                        const dt =
                                            val -
                                            waveCanvas._lastScrubVal;

                                        if (
                                            dr >
                                            0.03
                                        ) {
                                            const rate =
                                                dt /
                                                dr;

                                            if (
                                                Math.abs(
                                                    rate
                                                ) >
                                                0.05
                                            ) {
                                                audioEl.scrub(
                                                    val,
                                                    rate
                                                );
                                            }

                                            waveCanvas._lastScrubTime =
                                                pnow;

                                            waveCanvas._lastScrubVal =
                                                val;
                                        }

                                        if (
                                            !audioEl.paused
                                        ) {
                                            audioEl.pause();

                                            playBtn.innerHTML =
                                                "▶";
                                        }

                                        triggerDraw();

                                        app.graph.setDirtyCanvas(
                                            true,
                                            false
                                        );
                                    };

                                const scrubCleanup =
                                    () => {
                                        waveCanvas.removeEventListener(
                                            "pointermove",
                                            scrubMove
                                        );

                                        waveCanvas.removeEventListener(
                                            "pointerup",
                                            scrubCleanup
                                        );
                                    };

                                waveCanvas.addEventListener(
                                    "pointermove",
                                    scrubMove
                                );

                                waveCanvas.addEventListener(
                                    "pointerup",
                                    scrubCleanup
                                );

                                return;
                            }

                            /*
                             * Красная кнопка Refresh удалена.
                             * Раньше здесь проверялась область:
                             *
                             * Math.hypot(nx - (baseW - 8), ny - 8) <= 25
                             *
                             * и очищались customMarkers.
                             *
                             * Теперь очистка выполняется только
                             * синей кнопкой Reset.
                             */

                            let clickedMinusIndex =
                                -1;

                            for (
                                let i = 0;
                                i <
                                customMarkers.length;
                                i++
                            ) {
                                const mNx =
                                    getLogicalPx(
                                        customMarkers[
                                            i
                                        ]
                                    );

                                if (
                                    Math.abs(
                                        nx -
                                            mNx
                                    ) <= 20 &&
                                    ny >=
                                        baseH -
                                            24
                                ) {
                                    clickedMinusIndex =
                                        i;

                                    break;
                                }
                            }

                            if (
                                clickedMinusIndex !==
                                -1
                            ) {
                                customMarkers.splice(
                                    clickedMinusIndex,
                                    1
                                );

                                triggerDraw();

                                return;
                            }

                            const sNx =
                                getLogicalPx(
                                    bounds.start
                                );

                            const eNx =
                                getLogicalPx(
                                    bounds.end
                                );

                            const addMarker = (
                                time
                            ) => {
                                if (
                                    !customMarkers.includes(
                                        time
                                    )
                                ) {
                                    customMarkers.push(
                                        time
                                    );

                                    triggerDraw();
                                }
                            };

                            if (
                                ny >=
                                baseH - 24
                            ) {
                                if (
                                    Math.abs(
                                        nx - pNx
                                    ) <= 20
                                ) {
                                    addMarker(
                                        audioEl.currentTime
                                    );

                                    return;
                                }

                                if (
                                    Math.abs(
                                        nx - sNx
                                    ) <= 20
                                ) {
                                    addMarker(
                                        bounds.start
                                    );

                                    return;
                                }

                                if (
                                    Math.abs(
                                        nx - eNx
                                    ) <= 20
                                ) {
                                    addMarker(
                                        bounds.end
                                    );

                                    return;
                                }
                            }

                            try {
                                waveCanvas.setPointerCapture(
                                    e.pointerId
                                );
                            } catch (x) {}

                            const tStart =
                                bounds.start;

                            const tEnd =
                                bounds.end;

                            let activeHandle =
                                null;

                            /*
                             * УВЕЛИЧЕННАЯ ЗОНА ЗАХВАТА
                             *
                             * Было: 8 px
                             * Стало: 14 px
                             *
                             * Это особенно помогает, когда
                             * start/end находятся точно у края.
                             */
                            const HANDLE_HIT_PX =
                                14;

                            const handleTol =
                                (HANDLE_HIT_PX /
                                    rect.width) *
                                waveZoom *
                                audioDuration;

                            if (
                                Math.abs(
                                    clickTime -
                                        tStart
                                ) <= handleTol
                            ) {
                                activeHandle =
                                    "start";
                            } else if (
                                Math.abs(
                                    clickTime -
                                        tEnd
                                ) <= handleTol
                            ) {
                                activeHandle =
                                    "end";
                            } else if (
                                clickTime >
                                    tStart &&
                                clickTime <
                                    tEnd
                            ) {
                                activeHandle =
                                    "move";

                                waveCanvas._dragOffset =
                                    clickTime -
                                    tStart;

                                waveCanvas._dragWidth =
                                    tEnd -
                                    tStart;
                            } else {
                                activeHandle =
                                    "move";

                                const dur =
                                    tEnd -
                                    tStart;

                                waveCanvas._dragOffset =
                                    dur / 2;

                                waveCanvas._dragWidth =
                                    dur;
                            }

                            const move = (
                                mv
                            ) => {
                                if (
                                    !(
                                        mv.buttons &
                                        1
                                    )
                                ) {
                                    cleanup();
                                    return;
                                }

                                const mx =
                                    Math.max(
                                        0,
                                        Math.min(
                                            mv.clientX -
                                                rect.left,
                                            rect.width
                                        )
                                    );

                                const valRatio =
                                    (mx /
                                        rect.width) *
                                        waveZoom +
                                    waveOffset;

                                let val =
                                    valRatio *
                                    audioDuration;

                                const snapTolerance =
                                    (10 /
                                        rect.width) *
                                    waveZoom *
                                    audioDuration;

                                let snapTarget =
                                    null;

                                let minDiff =
                                    snapTolerance;

                                if (
                                    Math.abs(
                                        val -
                                            audioEl.currentTime
                                    ) <
                                    minDiff
                                ) {
                                    minDiff =
                                        Math.abs(
                                            val -
                                                audioEl.currentTime
                                        );

                                    snapTarget =
                                        audioEl.currentTime;
                                }

                                for (let m of customMarkers) {
                                    if (
                                        Math.abs(
                                            val -
                                                m
                                        ) <
                                        minDiff
                                    ) {
                                        minDiff =
                                            Math.abs(
                                                val -
                                                    m
                                            );

                                        snapTarget =
                                            m;
                                    }
                                }

                                if (
                                    snapTarget !==
                                        null &&
                                    (activeHandle ===
                                        "start" ||
                                        activeHandle ===
                                            "end")
                                ) {
                                    val =
                                        snapTarget;
                                }

                                if (
                                    activeHandle ===
                                        "start" &&
                                    startWidget
                                ) {
                                    startWidget.value =
                                        Math.max(
                                            0,
                                            Math.min(
                                                val,
                                                tEnd
                                            )
                                        );
                                } else if (
                                    activeHandle ===
                                        "end" &&
                                    endWidget
                                ) {
                                    endWidget.value =
                                        Math.max(
                                            tStart,
                                            Math.min(
                                                val,
                                                audioDuration
                                            )
                                        );
                                } else if (
                                    activeHandle ===
                                    "move"
                                ) {
                                    let ns =
                                        val -
                                        waveCanvas._dragOffset;

                                    let ne =
                                        ns +
                                        waveCanvas._dragWidth;

                                    if (
                                        ns < 0
                                    ) {
                                        ns = 0;

                                        ne =
                                            waveCanvas._dragWidth;
                                    }

                                    if (
                                        ne >
                                        audioDuration
                                    ) {
                                        ne =
                                            audioDuration;

                                        ns =
                                            audioDuration -
                                            waveCanvas._dragWidth;
                                    }

                                    if (
                                        startWidget
                                    )
                                        startWidget.value =
                                            ns;

                                    if (
                                        endWidget
                                    )
                                        endWidget.value =
                                            ne;
                                }

                                if (
                                    !audioEl.paused
                                ) {
                                    audioEl.pause();

                                    playBtn.innerHTML =
                                        "▶";
                                }

                                triggerDraw();

                                app.graph.setDirtyCanvas(
                                    true,
                                    false
                                );
                            };

                            const cleanup =
                                () => {
                                    waveCanvas.removeEventListener(
                                        "pointermove",
                                        move
                                    );

                                    waveCanvas.removeEventListener(
                                        "pointerup",
                                        cleanup
                                    );
                                };

                            waveCanvas.addEventListener(
                                "pointermove",
                                move
                            );

                            waveCanvas.addEventListener(
                                "pointerup",
                                cleanup
                            );
                        }
                    );

                    const loadAudioData =
                        async (
                            filename
                        ) => {
                            const shortName =
                                filename
                                    .split(
                                        /[/\\]/
                                    )
                                    .pop();

                            fileDisplay.value =
                                shortName;

                            const url =
                                api.apiURL(
                                    `/view?filename=${encodeURIComponent(
                                        filename
                                    )}&type=input`
                                );

                            try {
                                const res =
                                    await fetch(
                                        url
                                    );

                                const bytes =
                                    await res.arrayBuffer();

                                const ctx =
                                    getAudioContext();

                                const buffer =
                                    await ctx.decodeAudioData(
                                        bytes
                                    );

                                audioDuration =
                                    buffer.duration;

                                currentPeaks =
                                    computePeaks(
                                        buffer,
                                        4000
                                    );

                                audioEl.setBuffer(
                                    buffer
                                );

                                waveZoom = 1.0;
                                waveOffset = 0.0;

                                updateZoomUI();

                                await fetchPresets();

                                if (
                                    savedPresetsData[
                                        shortName
                                    ]
                                ) {
                                    presetSelect.value =
                                        shortName;

                                    applyPreset(
                                        shortName
                                    );
                                } else {
                                    presetSelect.value =
                                        "";

                                    customMarkers =
                                        [];

                                    if (
                                        endWidget &&
                                        parseFloat(
                                            endWidget.value
                                        ) === 0
                                    ) {
                                        endWidget.value =
                                            audioDuration;
                                    }
                                }

                                audioEl.currentTime =
                                    getTrimmedBounds().start;

                                triggerDraw();
                            } catch (e) {
                                console.error(
                                    "Peak extraction failed",
                                    e
                                );

                                currentPeaks =
                                    [];

                                triggerDraw();
                            }
                        };

                    let isConfiguring =
                        false;

                    const origConfigure =
                        this.onConfigure;

                    this.onConfigure =
                        function (info) {
                            isConfiguring =
                                true;

                            if (
                                origConfigure
                            )
                                origConfigure.apply(
                                    this,
                                    arguments
                                );

                            if (
                                fileWidget &&
                                fileWidget.value
                            )
                                loadAudioData(
                                    fileWidget.value
                                );

                            isConfiguring =
                                false;
                        };

                    if (fileWidget) {
                        const originalCallback =
                            fileWidget.callback;

                        fileWidget.callback =
                            function () {
                                if (
                                    !isConfiguring
                                ) {
                                    if (
                                        startWidget
                                    )
                                        startWidget.value =
                                            0;

                                    if (
                                        endWidget
                                    )
                                        endWidget.value =
                                            0;
                                }

                                if (this.value)
                                    loadAudioData(
                                        this.value
                                    );

                                if (
                                    originalCallback
                                )
                                    originalCallback.apply(
                                        this,
                                        arguments
                                    );
                            };

                        if (
                            fileWidget.value
                        )
                            loadAudioData(
                                fileWidget.value
                            );
                    }

                    if (startWidget) {
                        const origStartCb =
                            startWidget.callback;

                        startWidget.callback =
                            function () {
                                triggerDraw();

                                if (
                                    origStartCb
                                )
                                    origStartCb.apply(
                                        this,
                                        arguments
                                    );
                            };
                    }

                    if (endWidget) {
                        const origEndCb =
                            endWidget.callback;

                        endWidget.callback =
                            function () {
                                triggerDraw();

                                if (
                                    origEndCb
                                )
                                    origEndCb.apply(
                                        this,
                                        arguments
                                    );
                            };
                    }

                    playBtn.onclick =
                        () => {
                            if (
                                audioEl.paused
                            ) {
                                const bounds =
                                    getTrimmedBounds();

                                if (
                                    audioEl.currentTime >=
                                        bounds.end ||
                                    audioEl.currentTime <
                                        bounds.start
                                ) {
                                    audioEl.currentTime =
                                        bounds.start;
                                }

                                audioEl.play();

                                playBtn.innerHTML =
                                    "⏸";
                            } else {
                                audioEl.pause();

                                playBtn.innerHTML =
                                    "▶";
                            }
                        };

                    audioEl.ontimeupdate =
                        () => {
                            triggerDraw();

                            const bounds =
                                getTrimmedBounds();

                            if (
                                audioEl.currentTime >=
                                bounds.end
                            ) {
                                audioEl.pause();

                                audioEl.currentTime =
                                    bounds.start;

                                playBtn.innerHTML =
                                    "▶";
                            }
                        };

                    audioEl.onended =
                        () => {
                            playBtn.innerHTML =
                                "▶";
                        };

                    menuBtn.onclick = (
                        e
                    ) => {
                        e.stopPropagation();

                        const existingMenu =
                            document.getElementById(
                                "orex-download-menu"
                            );

                        if (
                            existingMenu
                        )
                            existingMenu.remove();

                        const menu =
                            document.createElement(
                                "div"
                            );

                        menu.id =
                            "orex-download-menu";

                        menu.style.position =
                            "fixed";

                        menu.style.left =
                            `${
                                e.clientX -
                                80
                            }px`;

                        menu.style.top =
                            `${
                                e.clientY +
                                15
                            }px`;

                        menu.style.background =
                            "#2b2b2b";

                        menu.style.border =
                            "1px solid #444";

                        menu.style.borderRadius =
                            "4px";

                        menu.style.padding =
                            "4px 0";

                        menu.style.zIndex =
                            "10000";

                        menu.style.boxShadow =
                            "0 4px 6px rgba(0,0,0,0.3)";

                        const downloadOpt =
                            document.createElement(
                                "div"
                            );

                        downloadOpt.innerText =
                            "⬇ Скачать MP3";

                        downloadOpt.style.cursor =
                            "pointer";

                        downloadOpt.style.color =
                            "#ddd";

                        downloadOpt.style.padding =
                            "6px 16px";

                        downloadOpt.style.fontFamily =
                            "sans-serif";

                        downloadOpt.style.fontSize =
                            "13px";

                        downloadOpt.onmouseover =
                            () =>
                                (downloadOpt.style.backgroundColor =
                                    "#444");

                        downloadOpt.onmouseout =
                            () =>
                                (downloadOpt.style.backgroundColor =
                                    "transparent");

                        downloadOpt.onclick =
                            async () => {
                                if (
                                    !fileWidget ||
                                    !fileWidget.value
                                ) {
                                    alert(
                                        "Выберите файл для сохранения."
                                    );

                                    return;
                                }

                                downloadOpt.innerText =
                                    "⏳ Формирование MP3...";

                                downloadOpt.style.pointerEvents =
                                    "none";

                                try {
                                    const normWidget =
                                        this.widgets.find(
                                            (
                                                w
                                            ) =>
                                                w.name ===
                                                "normalize_audio"
                                        );

                                    const resp =
                                        await api.fetchApi(
                                            "/orex/trim_download_mp3",
                                            {
                                                method:
                                                    "POST",

                                                headers:
                                                    {
                                                        "Content-Type":
                                                            "application/json",
                                                    },

                                                body: JSON.stringify(
                                                    {
                                                        filename:
                                                            fileWidget.value,

                                                        start_time:
                                                            startWidget
                                                                ? parseFloat(
                                                                      startWidget.value
                                                                  )
                                                                : 0,

                                                        end_time:
                                                            endWidget
                                                                ? parseFloat(
                                                                      endWidget.value
                                                                  )
                                                                : 0,

                                                        normalize_audio:
                                                            normWidget
                                                                ? parseFloat(
                                                                      normWidget.value
                                                                  )
                                                                : -18.0,
                                                    }
                                                ),
                                            }
                                        );

                                    if (
                                        !resp.ok
                                    )
                                        throw new Error(
                                            "Сервер не смог подготовить файл."
                                        );

                                    const data =
                                        await resp.json();

                                    const a =
                                        document.createElement(
                                            "a"
                                        );

                                    a.href =
                                        api.apiURL(
                                            data.url
                                        );

                                    a.download =
                                        data.url
                                            .split(
                                                "filename="
                                            )[1]
                                            .split(
                                                "&"
                                            )[0];

                                    a.click();
                                } catch (
                                    err
                                ) {
                                    console.error(
                                        err
                                    );

                                    alert(
                                        "Ошибка скачивания: Убедитесь, что в системе установлен ffmpeg, требуемый для pydub.export()."
                                    );
                                } finally {
                                    menu.remove();
                                }
                            };

                        menu.appendChild(
                            downloadOpt
                        );

                        document.body.appendChild(
                            menu
                        );

                        setTimeout(
                            () => {
                                window.addEventListener(
                                    "click",
                                    function closeMenu() {
                                        if (
                                            document.body.contains(
                                                menu
                                            )
                                        )
                                            menu.remove();

                                        window.removeEventListener(
                                            "click",
                                            closeMenu
                                        );
                                    }
                                );
                            },
                            10
                        );
                    };

                    return r;
                };
        }
    },
});