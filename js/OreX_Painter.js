import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "orex Painter";
const SUBFOLDER = "orex_painter";

function el(tag, styles = {}, text = "") {
    const element = document.createElement(tag);
    Object.assign(element.style, styles);
    if (text) element.textContent = text;
    return element;
}

function findWidget(node, name) {
    return node.widgets?.find((widget) => widget.name === name);
}

function hideWidget(widget) {
    widget.type = "orex-hidden";
    widget.computeSize = () => [0, -4];
    widget.draw = () => {};
}

function annotatedImageUrl(value) {
    if (!value) return null;
    const cleaned = String(value).replace(/\s*\[input\]\s*$/, "").replaceAll("\\", "/");
    const slash = cleaned.lastIndexOf("/");
    const filename = slash >= 0 ? cleaned.slice(slash + 1) : cleaned;
    const subfolder = slash >= 0 ? cleaned.slice(0, slash) : "";
    const query = new URLSearchParams({ filename, subfolder, type: "input" });
    return api.apiURL(`/view?${query.toString()}`);
}

function connectedPreview(node) {
    const input = node.inputs?.find((item) => item.name === "image");
    if (input?.link == null) return null;
    const link = app.graph?.links?.[input.link];
    const source = link && app.graph?.getNodeById(link.origin_id);
    if (!source?.imgs?.length) return null;
    const index = Math.max(0, Math.min(source.imageIndex ?? 0, source.imgs.length - 1));
    const image = source.imgs[index];
    return image?.src ? image : null;
}

function canvasBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Canvas export failed")), "image/png");
    });
}

function colorWithAlpha(hex, alpha) {
    const number = parseInt(String(hex).replace("#", ""), 16);
    const safe = Number.isFinite(number) ? number : 0xff0000;
    return `rgba(${safe >> 16},${(safe >> 8) & 255},${safe & 255},${alpha})`;
}

function createPainter(node, maskWidget) {
    const root = el("div", {
        width: "100%", height: "100%", boxSizing: "border-box", padding: "6px",
        display: "flex", flexDirection: "column", gap: "7px", color: "#ddd",
        font: "12px Arial, sans-serif", overflow: "hidden", userSelect: "none",
        pointerEvents: "auto",
    });

    const stage = el("div", {
        position: "relative", width: "100%", minHeight: "260px", flex: "1 1 auto",
        overflow: "hidden", borderRadius: "7px", backgroundColor: "#161616",
        backgroundImage: "linear-gradient(45deg,#222 25%,transparent 25%),linear-gradient(-45deg,#222 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#222 75%),linear-gradient(-45deg,transparent 75%,#222 75%)",
        backgroundSize: "16px 16px", backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
    });
    const base = el("img", {
        position: "absolute", inset: "0", width: "100%", height: "100%",
        objectFit: "contain", pointerEvents: "none", display: "none",
    });
    const canvas = el("canvas", {
        position: "absolute", inset: "0", width: "100%", height: "100%",
        touchAction: "none", cursor: "none", pointerEvents: "auto",
    });
    const brushCursor = el("div", {
        position: "absolute", left: "0", top: "0", width: "20px", height: "20px",
        borderRadius: "50%", border: "1px solid #ff0000", boxSizing: "border-box",
        transform: "translate(-50%, -50%)", pointerEvents: "none", display: "none",
        zIndex: "5", boxShadow: "0 0 0 1px rgba(255,255,255,.85)",
    });
    stage.append(base, canvas, brushCursor);

    const info = el("div", { textAlign: "center", color: "#aaa", height: "15px" }, "512 × 512");
    const status = el("div", { textAlign: "center", color: "#999", minHeight: "14px" }, "Connect IMAGE or paint on a blank canvas");

    const toolRow = el("div", { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px" });
    const brushButton = el("button", {}, "Brush");
    const eraserButton = el("button", {}, "Eraser");
    toolRow.append(brushButton, eraserButton);

    const buttonStyle = {
        border: "0", borderRadius: "4px", padding: "6px", color: "#eee",
        background: "#3b3b42", cursor: "pointer", fontWeight: "600",
    };
    Object.assign(brushButton.style, buttonStyle);
    Object.assign(eraserButton.style, buttonStyle);

    const controls = el("div", { display: "grid", gridTemplateColumns: "82px 1fr 43px", gap: "5px 7px", alignItems: "center" });
    const size = document.createElement("input");
    size.type = "range"; size.min = "1"; size.max = "300"; size.value = "20";
    const sizeValue = el("span", { textAlign: "right" }, "20");

    const color = document.createElement("input");
    color.type = "color"; color.value = "#ff0000"; color.style.width = "100%";
    const opacity = document.createElement("input");
    opacity.type = "range"; opacity.min = "1"; opacity.max = "100"; opacity.value = "10";
    const opacityValue = el("span", { textAlign: "right" }, "10%");

    const hardness = document.createElement("input");
    hardness.type = "range"; hardness.min = "0"; hardness.max = "100"; hardness.value = "100";
    const hardnessValue = el("span", { textAlign: "right" }, "100%");

    controls.append(
        el("span", {}, "Cursor Size"), size, sizeValue,
        el("span", {}, "Color Picker"), color, el("span", { textAlign: "right" }, "Color"),
        el("span", {}, "Opacity"), opacity, opacityValue,
        el("span", {}, "Hardness"), hardness, hardnessValue,
    );

    const actionRow = el("div", { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px" });
    const undoButton = el("button", {}, "↶ Undo");
    const clearButton = el("button", {}, "Clear");
    Object.assign(undoButton.style, buttonStyle);
    Object.assign(clearButton.style, buttonStyle);
    actionRow.append(undoButton, clearButton);

    root.append(stage, info, toolRow, controls, actionRow, status);

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let mode = "brush";
    let painting = false;
    let lastPoint = null;
    let dirty = false;
    let hasPaint = false;
    let revision = 0;
    let sourceUrl = null;
    let disposed = false;
    let cursorPosition = null;
    const undo = [];

    function updateCursorAppearance() {
        const rect = canvas.getBoundingClientRect();
        const scale = canvas.width > 0 ? rect.width / canvas.width : 1;
        const diameter = Math.max(2, Number(size.value) * scale);
        const alpha = Number(opacity.value) / 100;
        const hard = Number(hardness.value) / 100;
        brushCursor.style.width = `${diameter}px`;
        brushCursor.style.height = `${diameter}px`;
        brushCursor.style.borderColor = color.value;
        if (mode === "eraser") {
            brushCursor.style.background = "rgba(0,0,0,.08)";
            brushCursor.style.borderStyle = "dashed";
        } else if (hard >= 0.999) {
            brushCursor.style.background = colorWithAlpha(color.value, alpha);
            brushCursor.style.borderStyle = "solid";
        } else {
            const stop = Math.round(hard * 100);
            brushCursor.style.background = `radial-gradient(circle, ${colorWithAlpha(color.value, alpha)} 0%, ${colorWithAlpha(color.value, alpha)} ${stop}%, ${colorWithAlpha(color.value, 0)} 100%)`;
            brushCursor.style.borderStyle = "solid";
        }
        if (cursorPosition) {
            brushCursor.style.left = `${cursorPosition.x}px`;
            brushCursor.style.top = `${cursorPosition.y}px`;
        }
    }

    function setMode(nextMode) {
        mode = nextMode;
        brushButton.style.background = mode === "brush" ? "#5d5f6b" : "#3b3b42";
        eraserButton.style.background = mode === "eraser" ? "#5d5f6b" : "#3b3b42";
        updateCursorAppearance();
    }

    function configuredDimensions() {
        return [Math.max(64, Number(findWidget(node, "width")?.value) || 512),
                Math.max(64, Number(findWidget(node, "height")?.value) || 512)];
    }

    function resizeCanvas(width, height, preserve = false) {
        width = Math.max(1, Math.round(width));
        height = Math.max(1, Math.round(height));
        if (canvas.width === width && canvas.height === height) return;
        let old = null;
        if (preserve && canvas.width && canvas.height) {
            old = document.createElement("canvas");
            old.width = canvas.width; old.height = canvas.height;
            old.getContext("2d").drawImage(canvas, 0, 0);
        }
        canvas.width = width; canvas.height = height;
        if (old) ctx.drawImage(old, 0, 0, width, height);
        stage.style.aspectRatio = `${width} / ${height}`;
        info.textContent = `${width} × ${height}`;
        dirty = dirty || Boolean(old);
    }

    async function loadMask(value) {
        const url = annotatedImageUrl(value);
        if (!url) return;
        const image = new Image();
        image.onload = () => {
            resizeCanvas(image.naturalWidth, image.naturalHeight);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0);
            hasPaint = true;
            dirty = false;
            status.textContent = "Saved mask restored";
        };
        image.onerror = () => { status.textContent = "Could not restore saved mask"; };
        image.src = `${url}&t=${Date.now()}`;
    }

    function refreshSource() {
        const preview = connectedPreview(node);
        if (preview?.src) {
            if (preview.src !== sourceUrl) {
                sourceUrl = preview.src;
                base.onload = () => {
                    resizeCanvas(base.naturalWidth, base.naturalHeight, true);
                    base.style.display = "block";
                    status.textContent = "IMAGE preview loaded";
                };
                base.src = preview.src;
            }
        } else {
            sourceUrl = null;
            base.removeAttribute("src");
            base.style.display = "none";
            const [width, height] = configuredDimensions();
            resizeCanvas(width, height, true);
            stage.style.backgroundColor = findWidget(node, "bg_color")?.value || "#000000";
        }
    }

    function pointFromEvent(event) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) * canvas.width / rect.width,
            y: (event.clientY - rect.top) * canvas.height / rect.height,
        };
    }

    function pushUndo() {
        try {
            undo.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
            while (undo.length > 3) undo.shift();
        } catch (error) {
            console.warn("OreX Painter: undo snapshot failed", error);
        }
    }

    function stamp(point) {
        const radius = Number(size.value) / 2;
        const alpha = Number(opacity.value) / 100;
        const hard = Number(hardness.value) / 100;
        ctx.save();
        ctx.globalCompositeOperation = mode === "eraser" ? "destination-out" : "source-over";
        const solid = mode === "eraser" ? `rgba(0,0,0,${alpha})` : colorWithAlpha(color.value, alpha);
        if (hard >= 0.999) {
            // Equal radial-gradient radii are degenerate in Canvas2D and can
            // produce an entirely invisible brush at the default 100% value.
            ctx.fillStyle = solid;
        } else {
            const innerRadius = Math.max(0, radius * hard);
            const gradient = ctx.createRadialGradient(point.x, point.y, innerRadius, point.x, point.y, radius);
            const clear = mode === "eraser" ? "rgba(0,0,0,0)" : colorWithAlpha(color.value, 0);
            gradient.addColorStop(0, solid);
            gradient.addColorStop(Math.max(0.001, hard), solid);
            gradient.addColorStop(1, clear);
            ctx.fillStyle = gradient;
        }
        ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }

    function stroke(from, to) {
        const distance = Math.hypot(to.x - from.x, to.y - from.y);
        const spacing = Math.max(1, Number(size.value) * 0.12);
        const steps = Math.max(1, Math.ceil(distance / spacing));
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            stamp({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
        }
    }

    canvas.addEventListener("pointerdown", (event) => {
        event.preventDefault(); event.stopPropagation();
        pushUndo(); painting = true; lastPoint = pointFromEvent(event);
        canvas.setPointerCapture(event.pointerId); stamp(lastPoint);
        dirty = true; hasPaint = true; revision++;
        status.textContent = mode === "brush" ? "Painting…" : "Erasing…";
    });
    canvas.addEventListener("pointerenter", (event) => {
        const rect = canvas.getBoundingClientRect();
        cursorPosition = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        brushCursor.style.display = "block";
        updateCursorAppearance();
    });
    canvas.addEventListener("pointermove", (event) => {
        const rect = canvas.getBoundingClientRect();
        cursorPosition = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        brushCursor.style.display = "block";
        updateCursorAppearance();
        if (!painting) return;
        event.preventDefault(); event.stopPropagation();
        const next = pointFromEvent(event); stroke(lastPoint, next); lastPoint = next;
        dirty = true;
    });
    const stopPainting = (event) => {
        if (!painting) return;
        painting = false; lastPoint = null; revision++;
        if (event?.pointerId != null && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener("pointerup", stopPainting);
    canvas.addEventListener("pointercancel", stopPainting);
    canvas.addEventListener("pointerleave", () => {
        if (!painting) brushCursor.style.display = "none";
    });

    brushButton.onclick = () => setMode("brush");
    eraserButton.onclick = () => setMode("eraser");
    size.oninput = () => { sizeValue.textContent = size.value; updateCursorAppearance(); };
    color.oninput = updateCursorAppearance;
    opacity.oninput = () => { opacityValue.textContent = `${opacity.value}%`; updateCursorAppearance(); };
    hardness.oninput = () => { hardnessValue.textContent = `${hardness.value}%`; updateCursorAppearance(); };
    clearButton.onclick = () => {
        pushUndo(); ctx.clearRect(0, 0, canvas.width, canvas.height);
        dirty = true; hasPaint = false; revision++; status.textContent = "Canvas cleared";
    };
    undoButton.onclick = () => {
        const snapshot = undo.pop();
        if (!snapshot) return;
        resizeCanvas(snapshot.width, snapshot.height);
        ctx.putImageData(snapshot, 0, 0);
        dirty = true; hasPaint = true; revision++; status.textContent = "Undo";
    };

    async function serialize() {
        if (!hasPaint) {
            maskWidget.value = "";
            return "";
        }
        if (!dirty && maskWidget.value) return maskWidget.value;
        status.textContent = "Saving mask…";
        const blob = await canvasBlob(canvas);
        const filename = `orex_painter_${node.id}_${Date.now()}_${revision}.png`;
        const form = new FormData();
        form.append("image", blob, filename);
        form.append("type", "input");
        form.append("subfolder", SUBFOLDER);
        form.append("overwrite", "true");
        const response = await api.fetchApi("/upload/image", { method: "POST", body: form });
        if (!response.ok) throw new Error(`Mask upload failed (${response.status})`);
        const result = await response.json();
        const value = `${result.subfolder ? `${result.subfolder}/` : ""}${result.name} [input]`;
        maskWidget.value = value;
        dirty = false;
        status.textContent = "Mask saved";
        return value;
    }

    maskWidget.serializeValue = serialize;
    const interval = window.setInterval(() => { if (!disposed) refreshSource(); }, 700);
    resizeCanvas(...configuredDimensions());
    setMode("brush");
    window.setTimeout(() => loadMask(maskWidget.value), 50);

    return {
        element: root,
        dispose() { disposed = true; window.clearInterval(interval); },
    };
}

app.registerExtension({
    name: "OreX.Painter.Legacy",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            const maskWidget = findWidget(this, "mask");
            if (!maskWidget) return result;
            hideWidget(maskWidget);
            const painter = createPainter(this, maskWidget);
            const domWidget = this.addDOMWidget("orex_painter_ui", "orex_painter", painter.element, {
                serialize: false,
                hideOnZoom: false,
                getMinHeight: () => 610,
                getMaxHeight: () => 610,
            });
            domWidget.serialize = false;
            this.setSize([Math.max(this.size[0], 350), 760]);
            const originalRemoved = this.onRemoved;
            this.onRemoved = function () {
                painter.dispose();
                return originalRemoved?.apply(this, arguments);
            };
            return result;
        };
    },
});
