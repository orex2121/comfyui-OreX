import { app } from "../../../scripts/app.js";
import { importA1111 } from "../../../scripts/pnginfo.js";
import { ComfyWidgets } from "../../../scripts/widgets.js";

let getDrawTextConfig = null;
let fileInput;

/**
 * Base class for handling workflow images.
 * Базовый класс для работы с изображениями рабочих процессов (workflow).
 */
class WorkflowImage {
	static accept = "";

	/**
	 * Calculates the bounds of the entire graph (all nodes) with padding.
	 * Вычисляет границы всего графа (всех нод) с учетом отступов.
	 */
	getBounds() {
		// Calculate the min max bounds for the nodes on the graph / Вычисляем минимальные и максимальные границы для нод на графе
		const bounds = app.graph._nodes.reduce(
			(p, n) => {
				if (n.pos[0] < p[0]) p[0] = n.pos[0];
				if (n.pos[1] < p[1]) p[1] = n.pos[1];
				const bounds = n.getBounding();
				const r = n.pos[0] + bounds[2];
				const b = n.pos[1] + bounds[3];
				if (r > p[2]) p[2] = r;
				if (b > p[3]) p[3] = b;
				return p;
			},
			[99999, 99999, -99999, -99999]
		);

		// Add padding / Добавляем отступы
		bounds[0] -= 150;
		bounds[1] -= 150;
		bounds[2] += 150;
		bounds[3] += 150;
		return bounds;
	}

	/**
	 * Saves the current canvas state.
	 * Сохраняет текущее состояние холста (канваса).
	 */
	saveState() {
		this.state = {
			scale: app.canvas.ds.scale,
			width: app.canvas.canvas.width,
			height: app.canvas.canvas.height,
			offset: app.canvas.ds.offset,
			transform: app.canvas.canvas.getContext("2d").getTransform(), // Save the original transformation matrix / Сохраняем оригинальную матрицу трансформации
		};
	}

	/**
	 * Restores the saved canvas state.
	 * Восстанавливает сохраненное состояние холста (канваса).
	 */
	restoreState() {
		app.canvas.ds.scale = this.state.scale;
		app.canvas.canvas.width = this.state.width;
		app.canvas.canvas.height = this.state.height;
		app.canvas.ds.offset = this.state.offset;
		app.canvas.canvas.getContext("2d").setTransform(this.state.transform); // Reapply the original transformation matrix / Применяем оригинальную матрицу трансформации обратно
	}

	/**
	 * Updates the canvas view to capture the entire workspace with the correct scale.
	 * Обновляет вид холста для захвата всей рабочей области с правильным масштабом.
	 */
	updateView(bounds) {
		const w = bounds[2] - bounds[0];
		const h = bounds[3] - bounds[1];
		
		// Scale only for PNG, SVG doesn't need it (vector).
		// Масштабируем только для PNG, SVG в этом не нуждается (так как это векторная графика).
		let scale = 1;
		if (this.extension === "png") {
			const MAX_DIM = 8192;
			const TARGET_SCALE = 1.5; 
			scale = TARGET_SCALE;

			if (w * scale > MAX_DIM || h * scale > MAX_DIM) {
				scale = Math.min(MAX_DIM / w, MAX_DIM / h);
			}
		}

		// Pass scaling directly to LiteGraph / Передаем масштабирование напрямую в LiteGraph
		app.canvas.ds.scale = scale; 
		app.canvas.canvas.width = w * scale;
		app.canvas.canvas.height = h * scale;
		app.canvas.ds.offset = [-bounds[0], -bounds[1]];
	}

	getDrawTextConfig(_, widget) {
		return {
			x: 10,
			y: widget.last_y + 10,
			resetTransform: false,
		};
	}

	/**
	 * Main export method.
	 * Основной метод экспорта.
	 */
	async export(includeWorkflow) {
		// Save the current state of the canvas / Сохраняем текущее состояние холста
		this.saveState();
		
		// Update to render the whole workflow / Обновляем вид для рендеринга всего рабочего процесса
		const bounds = this.getBounds();
		console.log("[OreX Workflow Image] Bounds / Границы:", bounds);
		this.updateView(bounds);
		
		// Force full redraw of all nodes / Принудительно полностью перерисовываем все ноды
		app.graph.setDirtyCanvas(true, true);
		app.canvas.setDirty(true, true);

		// Flag that we are saving and render the canvas / Устанавливаем флаг сохранения и рендерим холст
		getDrawTextConfig = this.getDrawTextConfig;
		app.canvas.draw(true, true);
		
		// Wait for async textures to load / Ждем загрузки асинхронных текстур
		await new Promise(r => setTimeout(r, 500));
		app.canvas.draw(true, true);

		// FORCE DRAW IMAGES: Manual pass to draw images that standard draw might skip
		// ПРИНУДИТЕЛЬНАЯ ОТРИСОВКА ИЗОБРАЖЕНИЙ: Ручной проход для отрисовки картинок, которые стандартный метод мог пропустить
		const ctx = app.canvas.ctx;
		
		ctx.save();
		// Replicate LiteGraph camera settings for accurate positioning / Воспроизводим настройки камеры LiteGraph для точного позиционирования
		if (ctx.setTransform) {
			ctx.setTransform(1, 0, 0, 1, 0, 0);
		}
		ctx.scale(app.canvas.ds.scale, app.canvas.ds.scale);
		ctx.translate(app.canvas.ds.offset[0], app.canvas.ds.offset[1]);

		for (const node of app.graph._nodes) {
			if (node.imgs && node.imgs.length > 0) {
				const img = node.imgs[0];
				if (img.complete && img.width > 0) {
					this.drawNodeImage(ctx, node, img);
				}
			}
		}
		ctx.restore();
		
		getDrawTextConfig = null;

		// Generate a blob of the image containing the workflow / Генерируем blob изображения, содержащего рабочий процесс
		const blob = await this.getBlob(includeWorkflow ? JSON.stringify(app.graph.serialize()) : undefined);
		console.log("[OreX Workflow Image] Blob size / Размер Blob:", blob ? blob.size : "null");

		// Restore initial state and redraw / Восстанавливаем исходное состояние и перерисовываем
		this.restoreState();
		app.canvas.draw(true, true);

		// Download the generated image / Скачиваем сгенерированное изображение
		this.download(blob);
	}

	/**
	 * Draws an image inside a node with correct positioning.
	 * Отрисовывает изображение внутри ноды с правильным позиционированием.
	 */
	drawNodeImage(ctx, node, img) {
		ctx.save();
		// Move to node position in world coordinates / Перемещаемся к позиции ноды в мировых координатах
		ctx.translate(node.pos[0], node.pos[1]);
		
		// Calculate reserved height for widgets / Вычисляем зарезервированную высоту для виджетов
		let contentStartY = 0;
		if (node.widgets && node.widgets.length > 0) {
			const headerHeight = 26; // LiteGraph header is usually ~26px / Заголовок LiteGraph обычно ~26px
			let widgetsHeight = 0;
			for (const w of node.widgets) {
				widgetsHeight += 28; // Estimate 28px per widget / Оцениваем примерно 28px на виджет
			}
			contentStartY = headerHeight + widgetsHeight + 5;
		}

		// Reserve space for specific node types / Резервируем место для специфических типов нод
		const isSampler = node.type && node.type.includes("Sampler");
		const isSave = node.type && (node.type.includes("Save") || node.type.includes("Output") || node.type.includes("Preview"));
		if (isSampler && contentStartY < 220) contentStartY = 220;

		const footerHeight = isSave ? 55 : 25; 
		const drawHeight = node.size[1] - contentStartY - footerHeight;
		
		if (drawHeight > 0) {
			try {
				// Calculate proportional scale to fit image into available area / Вычисляем пропорциональный масштаб для вписывания картинки в доступную область
				const imgAspect = img.width / img.height;
				const areaAspect = node.size[0] / drawHeight;
				
				let targetWidth, targetHeight, offsetXImg, offsetYImg;
				
				if (imgAspect > areaAspect) {
					// Image is wider than area / Изображение шире доступной области
					targetWidth = node.size[0];
					targetHeight = node.size[0] / imgAspect;
					offsetXImg = 0;
					offsetYImg = contentStartY + (drawHeight - targetHeight) / 2;
				} else {
					// Image is taller than area / Изображение выше доступной области
					targetHeight = drawHeight;
					targetWidth = drawHeight * imgAspect;
					offsetXImg = (node.size[0] - targetWidth) / 2;
					offsetYImg = contentStartY;
				}
				
				ctx.drawImage(img, offsetXImg, offsetYImg, targetWidth, targetHeight);
			} catch (e) {
				console.error("[OreX Workflow Image] Failed to draw image for node / Не удалось отрисовать изображение для ноды", node.id, e);
			}
		}
		ctx.restore();
	}

	/**
	 * Triggers the download of the file.
	 * Запускает скачивание файла.
	 */
	download(blob) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		Object.assign(a, {
			href: url,
			download: "workflow." + this.extension,
			style: "display: none",
		});
		document.body.append(a);
		a.click();
		setTimeout(function () {
			a.remove();
			window.URL.revokeObjectURL(url);
		}, 0);
	}

	/**
	 * Creates an input element to import a file.
	 * Создает элемент ввода для импорта файла.
	 */
	static import() {
		if (!fileInput) {
			fileInput = document.createElement("input");
			Object.assign(fileInput, {
				type: "file",
				style: "display: none",
				onchange: () => {
					app.handleFile(fileInput.files[0]);
				},
			});
			document.body.append(fileInput);
		}
		fileInput.accept = WorkflowImage.accept;
		fileInput.click();
	}
}

/**
 * Class to save workflow to a separate JSON file.
 * Класс для сохранения рабочего процесса в отдельный JSON файл.
 */
class JSONWorkflowSaver {
	static save() {
		try {
			const workflow = app.graph.serialize();
			const jsonStr = JSON.stringify(workflow, null, 2);
			
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
			const filename = `workflow_${timestamp}.json`;
			
			const blob = new Blob([jsonStr], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
			
			console.log("[OreX Workflow Image] JSON saved / JSON сохранен:", filename);
		} catch (error) {
			console.error("[OreX Workflow Image] Error saving JSON / Ошибка сохранения JSON:", error);
		}
	}
}

/**
 * Handler for PNG workflow images.
 * Обработчик для изображений рабочего процесса в формате PNG.
 */
class PngWorkflowImage extends WorkflowImage {
	static accept = ".png,image/png";
	extension = "png";

	n2b(n) {
		return new Uint8Array([(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
	}

	joinArrayBuffer(...bufs) {
		const result = new Uint8Array(bufs.reduce((totalSize, buf) => totalSize + buf.byteLength, 0));
		bufs.reduce((offset, buf) => {
			result.set(buf, offset);
			return offset + buf.byteLength;
		}, 0);
		return result;
	}

	crc32(data) {
		const crcTable =
			PngWorkflowImage.crcTable ||
			(PngWorkflowImage.crcTable = (() => {
				let c;
				const crcTable = [];
				for (let n = 0; n < 256; n++) {
					c = n;
					for (let k = 0; k < 8; k++) {
						c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
					}
					crcTable[n] = c;
				}
				return crcTable;
			})());
		let crc = 0 ^ -1;
		for (let i = 0; i < data.byteLength; i++) {
			crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xff];
		}
		return (crc ^ -1) >>> 0;
	}

	async getBlob(workflow) {
		return new Promise((r) => {
			// --- ИСПРАВЛЕНИЕ ПРОЗРАЧНОГО ФОНА ---
			// Создаем временный холст для обеспечения сплошного фона (без клеточек/прозрачности)
			const tempCanvas = document.createElement("canvas");
			tempCanvas.width = app.canvasEl.width;
			tempCanvas.height = app.canvasEl.height;
			const tempCtx = tempCanvas.getContext("2d");

			// Заливаем фон цветом (используем цвет фона холста ComfyUI или темно-серый по умолчанию)
			tempCtx.fillStyle = app.canvas.clear_background_color || "#222222";
			tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

			// Отрисовываем оригинальный холст (с возможной прозрачностью) поверх сплошного фона
			tempCtx.drawImage(app.canvasEl, 0, 0);

			// Генерируем Blob из нашего нового временного холста, а не напрямую из app.canvasEl
			tempCanvas.toBlob(async (blob) => {
				if (workflow) {
					// Embed workflow into PNG as tEXt chunk / Внедряем рабочий процесс в PNG как tEXt чанк
					const buffer = await blob.arrayBuffer();
					const typedArr = new Uint8Array(buffer);
					const view = new DataView(buffer);

					const data = new TextEncoder().encode(`tEXtworkflow\0${workflow}`);
					const chunk = this.joinArrayBuffer(this.n2b(data.byteLength - 4), data, this.n2b(this.crc32(data)));

					const sz = view.getUint32(8) + 20;
					const result = this.joinArrayBuffer(typedArr.subarray(0, sz), chunk, typedArr.subarray(sz));

					blob = new Blob([result], { type: "image/png" });
				}

				r(blob);
			}, "image/png");
		});
	}
}

// Data reader helper / Вспомогательный класс для чтения данных
class DataReader {
	/** @type {DataView} */
	view;
	/** @type {boolean | undefined} */
	littleEndian;
	offset = 0;

	constructor(view) {
		this.view = view;
	}

	read(size, signed = false, littleEndian = undefined) {
		const v = this.peek(size, signed, littleEndian);
		this.offset += size;
		return v;
	}

	peek(size, signed = false, littleEndian = undefined) {
		this.view.getBigInt64;
		let m = "";
		if (size === 8) m += "Big";
		m += signed ? "Int" : "Uint";
		m += size * 8;
		m = "get" + m;
		if (!this.view[m]) {
			throw new Error("Method not found / Метод не найден: " + m);
		}

		return this.view[m](this.offset, littleEndian == null ? this.littleEndian : littleEndian);
	}

	seek(pos, relative = true) {
		if (relative) {
			this.offset += pos;
		} else {
			this.offset = pos;
		}
	}
}

// TIFF metadata reader / Читатель метаданных TIFF
class Tiff {
	/** @type {DataReader} */
	#reader;
	#start;

	readExif(reader) {
		const TIFF_MARKER = 0x2a;
		const EXIF_IFD = 0x8769;

		this.#reader = reader;
		this.#start = this.#reader.offset;
		this.#readEndianness();

		if (this.#reader.read(2) !== TIFF_MARKER) {
			throw new Error("Invalid TIFF: Marker not found. / Неверный TIFF: Маркер не найден.");
		}

		const dirOffset = this.#reader.read(4);
		this.#reader.seek(this.#start + dirOffset, false);

		for (const t of this.#readTags()) {
			if (t.id === EXIF_IFD) {
				return this.#readExifTag(t);
			}
		}
		throw new Error("No EXIF: TIFF Exif IFD tag not found / Нет EXIF: Тег TIFF Exif IFD не найден");
	}

	#readUserComment(tag) {
		this.#reader.seek(this.#start + tag.offset, false);
		const encoding = this.#reader.read(8);
		if (encoding !== 0x45444f43494e55n) {
			throw new Error("Unable to read non-Unicode data / Невозможно прочитать данные, не являющиеся Unicode");
		}
		const decoder = new TextDecoder("utf-16be");
		return decoder.decode(new DataView(this.#reader.view.buffer, this.#reader.offset, tag.count - 8));
	}

	#readExifTag(exifTag) {
		const EXIF_USER_COMMENT = 0x9286;

		this.#reader.seek(this.#start + exifTag.offset, false);
		for (const t of this.#readTags()) {
			if (t.id === EXIF_USER_COMMENT) {
				return this.#readUserComment(t);
			}
		}
		throw new Error("No embedded data: UserComment Exif tag not found / Нет встроенных данных: Тег UserComment Exif не найден");
	}

	*#readTags() {
		const count = this.#reader.read(2);
		for (let i = 0; i < count; i++) {
			yield {
				id: this.#reader.read(2),
				type: this.#reader.read(2),
				count: this.#reader.read(4),
				offset: this.#reader.read(4),
			};
		}
	}

	#readEndianness() {
		const II = 0x4949;
		const MM = 0x4d4d;
		const endianness = this.#reader.read(2);
		if (endianness === II) {
			this.#reader.littleEndian = true;
		} else if (endianness === MM) {
			this.#reader.littleEndian = false;
		} else {
			throw new Error("Invalid TIFF: Endianness marker not found. / Неверный TIFF: Маркер порядка байтов не найден.");
		}
	}
}

// JPEG metadata reader / Читатель метаданных JPEG
class Jpeg {
	/** @type {DataReader} */
	#reader;

	readExif(buffer) {
		const JPEG_MARKER = 0xffd8;
		const EXIF_SIG = 0x45786966;

		this.#reader = new DataReader(new DataView(buffer));
		if (this.#reader.read(2) !== JPEG_MARKER) {
			throw new Error("Invalid JPEG: SOI not found. / Неверный JPEG: SOI не найден.");
		}

		const app0 = this.#readAppMarkerId();
		if (app0 !== 0) {
			throw new Error(`Invalid JPEG: APP0 not found / Неверный JPEG: APP0 не найден [found: ${app0}].`);
		}

		this.#consumeAppSegment();
		const app1 = this.#readAppMarkerId();
		if (app1 !== 1) {
			throw new Error(`No EXIF: APP1 not found / Нет EXIF: APP1 не найден [found: ${app1}].`);
		}

		// Skip size / Пропускаем размер
		this.#reader.seek(2);

		if (this.#reader.read(4) !== EXIF_SIG) {
			throw new Error(`No EXIF: Invalid EXIF header signature. / Нет EXIF: Неверная сигнатура заголовка EXIF.`);
		}
		if (this.#reader.read(2) !== 0) {
			throw new Error(`No EXIF: Invalid EXIF header. / Нет EXIF: Неверный заголовок EXIF.`);
		}

		return new Tiff().readExif(this.#reader);
	}

	#readAppMarkerId() {
		const APP0_MARKER = 0xffe0;
		return this.#reader.read(2) - APP0_MARKER;
	}

	#consumeAppSegment() {
		this.#reader.seek(this.#reader.read(2) - 2);
	}
}

/**
 * Handler for SVG workflow images.
 * Обработчик для изображений рабочего процесса в формате SVG.
 */
class SvgWorkflowImage extends WorkflowImage {
	static accept = ".svg,image/svg+xml";
	extension = "svg";

	static init() {
		// Override file handling for drag & drop SVG and JPEG / Переопределяем обработку файлов для drag & drop SVG и JPEG
		const handleFile = app.handleFile;
		app.handleFile = async function (file) {
			if (file && (file.type === "image/svg+xml" || file.name?.endsWith(".svg"))) {
				const reader = new FileReader();
				reader.onload = () => {
					// Extract embedded workflow from desc tags / Извлекаем встроенный рабочий процесс из тегов desc
					const descEnd = reader.result.lastIndexOf("</desc>");
					if (descEnd !== -1) {
						const descStart = reader.result.lastIndexOf("<desc>", descEnd);
						if (descStart !== -1) {
							const json = reader.result.substring(descStart + 6, descEnd);
							this.loadGraphData(JSON.parse(SvgWorkflowImage.unescapeXml(json)));
						}
					}
				};
				reader.readAsText(file);
				return;
			} else if (file && (file.type === "image/jpeg" || file.name?.endsWith(".jpg") || file.name?.endsWith(".jpeg"))) {
				if (
					await new Promise((resolve) => {
						try {
							const reader = new FileReader();
							reader.onload = async () => {
								try {
									const value = new Jpeg().readExif(reader.result);
									importA1111(app.graph, value);
									resolve(true);
								} catch (error) {
									resolve(false);
								}
							};
							reader.onerror = () => resolve(false);
							reader.readAsArrayBuffer(file);
						} catch (error) {
							resolve(false);
						}
					})
				) {
					return;
				}
			}
			return handleFile.apply(this, arguments);
		};
	}

	static escapeXml(unsafe) {
		return unsafe.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
	}

	static unescapeXml(safe) {
		return safe.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
	}

	getDrawTextConfig(_, widget) {
		const domWrapper = widget.inputEl.closest(".dom-widget") ?? widget.inputEl;
		return {
			x: parseInt(domWrapper.style.left),
			y: parseInt(domWrapper.style.top),
			resetTransform: true,
		};
	}

	saveState() {
		super.saveState();
		this.state.ctx = app.canvas.ctx;
	}

	restoreState() {
		super.restoreState();
		app.canvas.ctx = this.state.ctx;
	}

	updateView(bounds) {
		super.updateView(bounds);
		this.createSvgCtx(bounds);
	}

	createSvgCtx(bounds) {
		const ctx = this.state.ctx;
		const svgCtx = (this.svgCtx = new C2S(bounds[2] - bounds[0], bounds[3] - bounds[1]));
		svgCtx.canvas.getBoundingClientRect = function () {
			return { width: svgCtx.width, height: svgCtx.height };
		};

		const drawImage = svgCtx.drawImage;
		svgCtx.drawImage = function (...args) {
			const image = args[0];
			if (image.nodeName === "IMG" && !image.src.startsWith("data:image/")) {
				const canvas = document.createElement("canvas");
				canvas.width = image.width;
				canvas.height = image.height;
				const imgCtx = canvas.getContext("2d");
				imgCtx.drawImage(image, 0, 0);
				args[0] = canvas;
			}

			return drawImage.apply(this, args);
		};

		svgCtx.getTransform = function () {
			return ctx.getTransform();
		};
		svgCtx.resetTransform = function () {
			return ctx.resetTransform();
		};
		svgCtx.roundRect = svgCtx.rect;
		app.canvas.ctx = svgCtx;
	}

	getBlob(workflow) {
		let svg = this.svgCtx.getSerializedSvg(true).replace("<svg ", `<svg style="background: ${app.canvas.clear_background_color}" `);

		if (workflow) {
			svg = svg.replace("</svg>", `<desc>${SvgWorkflowImage.escapeXml(workflow)}</desc></svg>`);
		}

		return new Blob([svg], { type: "image/svg+xml" });
	}
}

// Extension Registration / Регистрация расширения
app.registerExtension({
	name: "OreX.WorkflowImage",
	init() {
		function wrapText(context, text, x, y, maxWidth, lineHeight) {
			var words = text.split(" "),
				line = "",
				i,
				test,
				metrics;

			for (i = 0; i < words.length; i++) {
				test = words[i];
				metrics = context.measureText(test);
				while (metrics.width > maxWidth) {
					test = test.substring(0, test.length - 1);
					metrics = context.measureText(test);
				}
				if (words[i] != test) {
					words.splice(i + 1, 0, words[i].substr(test.length));
					words[i] = test;
				}

				test = line + words[i] + " ";
				metrics = context.measureText(test);

				if (metrics.width > maxWidth && i > 0) {
					context.fillText(line, x, y);
					line = words[i] + " ";
					y += lineHeight;
				} else {
					line = test;
				}
			}

			context.fillText(line, x, y);
		}

		const stringWidget = ComfyWidgets.STRING;
		// Override multiline string widgets for correct rendering / Переопределение многострочных текстовых виджетов для корректной отрисовки
		ComfyWidgets.STRING = function () {
			const w = stringWidget.apply(this, arguments);
			if (w.widget && w.widget.type === "customtext") {
				const draw = w.widget.draw;
				w.widget.draw = function (ctx) {
					draw.apply(this, arguments);
					if (this.inputEl.hidden) return;

					if (getDrawTextConfig) {
						const config = getDrawTextConfig(ctx, this);
						const t = ctx.getTransform();
						ctx.save();
						if (config.resetTransform) {
							ctx.resetTransform();
						}

						const style = document.defaultView.getComputedStyle(this.inputEl, null);
						const x = config.x;
						const y = config.y;
						const domWrapper = this.inputEl.closest(".dom-widget") ?? this.inputEl;
						let w = parseInt(domWrapper.style.width);
						if (w === 0) {
							w = this.node.size[0] - 20;
						}
						const h = parseInt(domWrapper.style.height);
						
						ctx.beginPath();
						ctx.rect(x, y, w, h);
						ctx.clip();
						
						ctx.fillStyle = style.getPropertyValue("background-color");
						ctx.fillRect(x, y, w, h);

						ctx.fillStyle = style.getPropertyValue("color");
						ctx.font = style.getPropertyValue("font");

						const line = t.d * 12;
						const split = this.inputEl.value.split("\n");
						let start = y;
						for (const l of split) {
							start += line;
							wrapText(ctx, l, x + 4, start, w, line);
						}

						ctx.restore();
					}
				};
			}
			return w;
		};
	},
	setup() {
		const script = document.createElement("script");
		script.onload = function () {
			const formats = [SvgWorkflowImage, PngWorkflowImage];
			for (const f of formats) {
				f.init?.call();
				WorkflowImage.accept += (WorkflowImage.accept ? "," : "") + f.accept;
			}

			// Add options to canvas menu / Добавление опций в меню канваса (рабочей области)
			const orig = LGraphCanvas.prototype.getCanvasMenuOptions;
			LGraphCanvas.prototype.getCanvasMenuOptions = function () {
				const options = orig.apply(this, arguments);

				options.push(null, {
					content: "📸 OreX Workflow Image",
					submenu: {
						options: [
							{
								content: "📂 Import (PNG/SVG)",
								callback: () => {
									WorkflowImage.import();
								},
							},
							{
								content: "📸 Save as PNG (with workflow)",
								callback: () => {
									new PngWorkflowImage().export(true);
								},
							},
							{
								content: "🖼️ Save as PNG (image only)",
								callback: () => {
									new PngWorkflowImage().export(false);
								},
							},
							{
								content: "📐 Save as SVG (with workflow)",
								callback: () => {
									new SvgWorkflowImage().export(true);
								},
							},
							{
								content: "📐 Save as SVG (vector only)",
								callback: () => {
									new SvgWorkflowImage().export(false);
								},
							},
							{
								content: "💾 Save as JSON",
								callback: () => {
									JSONWorkflowSaver.save();
								},
							}
						],
					},
				});
				return options;
			};
		};

		script.src = new URL(`assets/canvas2svg.js`, import.meta.url);
		document.body.append(script);
	},
});