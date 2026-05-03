(function () {
  const deck = document.querySelector(".deck");
  const slides = Array.from(document.querySelectorAll(".slide"));
  const progressFill = document.querySelector(".presenter-progress span");
  const laserPointer = document.querySelector(".laser-pointer");
  const inkLayer = document.querySelector(".ink-layer");
  const toolStatus = document.querySelector(".tool-status");
  const presentingClass = "presenting";
  const activeClass = "active";
  const laserClass = "laser-mode";
  const penClass = "pen-mode";
  const editingClass = "edit-mode";
  const editableSelector = [
    "h1",
    "h2",
    "h3",
    "p",
    ".meta span",
    ".point > span",
    ".axis-card span",
    ".experiment-table .head",
    ".bar-row > span",
    ".bar-row > strong",
    ".notes",
  ].join(", ");
  const defaultSlideWidth = 1280;
  const defaultSlideHeight = 720;
  let slideWidth = defaultSlideWidth;
  let slideHeight = defaultSlideHeight;
  let currentIndex = 0;
  let thumbnailButtons = [];
  let thumbnailPreviews = [];
  let editorButtons = {};
  let fileHandle = null;
  let isDirty = false;
  let wheelDeltaBuffer = 0;
  let wheelResetTimer = null;
  let speakerWindow = null;
  let startedAt = Date.now();
  let isDrawing = false;
  let lastInkPoint = null;
  const wheelStepSize = 110;
  const maxWheelStepsPerEvent = 3;
  const wheelResetDelayMs = 180;

  function clamp(index) {
    return Math.max(0, Math.min(index, slides.length - 1));
  }

  function hashToIndex(hash) {
    const match = hash.match(/^#slide-(\d+)$/);
    if (!match) return null;
    return clamp(Number(match[1]) - 1);
  }

  function updateHash(index) {
    const hash = `#slide-${index + 1}`;
    if (window.location.hash !== hash) {
      window.history.replaceState(null, "", hash);
    }
  }

  function updateDocumentTitle() {
    const title = slides[currentIndex]?.dataset.title || `Slide ${currentIndex + 1}`;
    document.title = `${title} · ${currentIndex + 1}/${slides.length}`;
  }

  function getSlideTitle(index) {
    return slides[index]?.dataset.title || `Slide ${index + 1}`;
  }

  function getSlideNotes(index) {
    return slides[index]?.querySelector(".notes")?.textContent.trim() || "No speaker notes.";
  }

  function readSlideSize() {
    const width = Number(deck?.dataset.width);
    const height = Number(deck?.dataset.height);

    slideWidth = Number.isFinite(width) && width > 0 ? width : defaultSlideWidth;
    slideHeight = Number.isFinite(height) && height > 0 ? height : defaultSlideHeight;

    document.documentElement.style.setProperty("--slide-width", `${slideWidth}px`);
    document.documentElement.style.setProperty("--slide-height", `${slideHeight}px`);
  }

  function formatSlideNumber(index) {
    return String(index + 1).padStart(2, "0");
  }

  function createSidebarAction(label, handler, variant = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = variant ? `sidebar-action ${variant}` : "sidebar-action";
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function clearEditableAttributes(root) {
    root.querySelectorAll("[contenteditable], [spellcheck], [data-editable]").forEach((element) => {
      element.removeAttribute("contenteditable");
      element.removeAttribute("spellcheck");
      element.removeAttribute("data-editable");
    });
  }

  function renderThumbnailPreview(preview, slide) {
    if (!preview || !slide) return;

    const clone = slide.cloneNode(true);
    clone.classList.remove(activeClass);
    clone.setAttribute("aria-hidden", "true");
    clearEditableAttributes(clone);
    preview.replaceChildren(clone);
  }

  function updateThumbnailLabel(index) {
    const label = thumbnailButtons[index]?.querySelector(".thumb-label");
    if (label) {
      label.textContent = `${formatSlideNumber(index)} · ${getSlideTitle(index)}`;
    }
  }

  function refreshThumbnail(index) {
    renderThumbnailPreview(thumbnailPreviews[index], slides[index]);
    updateThumbnailLabel(index);
  }

  function buildThumbnails() {
    const sidebar = document.createElement("aside");
    const title = document.createElement("p");
    const actions = document.createElement("div");
    const editButton = createSidebarAction("编辑文字", () => toggleEditMode(), "secondary");
    const saveButton = createSidebarAction("保存 HTML", () => saveHtml(), "secondary");
    const exportButton = document.createElement("button");
    const list = document.createElement("div");
    const thumbWidth = 176;
    const thumbHeight = thumbWidth * (slideHeight / slideWidth);
    const thumbScale = thumbWidth / slideWidth;

    sidebar.className = "presenter-sidebar";
    sidebar.setAttribute("aria-label", "Slide thumbnails");
    title.className = "sidebar-title";
    title.textContent = "Slides";
    actions.className = "sidebar-actions";
    editorButtons = {
      edit: editButton,
      save: saveButton,
    };

    exportButton.type = "button";
    exportButton.className = "sidebar-action";
    exportButton.textContent = "导出 PDF";
    exportButton.addEventListener("click", exportPdf);
    actions.append(editButton, saveButton, exportButton);
    list.className = "thumb-list";

    thumbnailButtons = slides.map((slide, index) => {
      const button = document.createElement("button");
      const preview = document.createElement("div");
      const label = document.createElement("span");
      const slideTitle = slide.dataset.title || `Slide ${index + 1}`;

      button.type = "button";
      button.className = "slide-thumb";
      button.setAttribute("aria-label", `Go to slide ${index + 1}: ${slideTitle}`);

      preview.className = "thumb-preview";
      preview.style.width = `${thumbWidth}px`;
      preview.style.height = `${thumbHeight}px`;
      preview.style.setProperty("--thumb-scale", String(thumbScale));

      label.className = "thumb-label";
      label.textContent = `${formatSlideNumber(index)} · ${slideTitle}`;

      renderThumbnailPreview(preview, slide);
      button.append(preview, label);
      button.addEventListener("click", () => {
        goTo(index);
      });

      list.appendChild(button);
      thumbnailPreviews[index] = preview;
      return button;
    });

    sidebar.append(title, actions, list);
    document.body.prepend(sidebar);
    updateEditorUi();
  }

  function updateThumbnails() {
    thumbnailButtons.forEach((button, index) => {
      const isActive = index === currentIndex;
      button.classList.toggle(activeClass, isActive);
      button.setAttribute("aria-current", isActive ? "true" : "false");
    });

    if (!document.body.classList.contains(presentingClass)) {
      thumbnailButtons[currentIndex]?.scrollIntoView({ block: "nearest" });
    }
  }

  function updateProgress() {
    if (!progressFill) return;
    const progress = slides.length <= 1
      ? 100
      : (currentIndex / (slides.length - 1)) * 100;
    progressFill.style.width = `${progress}%`;
  }

  function formatElapsed(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function stripNotesFromSlideHtml(slide) {
    const clone = slide.cloneNode(true);
    clone.querySelectorAll(".notes").forEach((note) => note.remove());
    clone.classList.add(activeClass);
    return clone.outerHTML;
  }

  function getSpeakerDocument() {
    return speakerWindow && !speakerWindow.closed ? speakerWindow.document : null;
  }

  function updateSpeakerView() {
    const doc = getSpeakerDocument();
    if (!doc) return;

    const currentSlot = doc.querySelector("[data-speaker-current]");
    const nextSlot = doc.querySelector("[data-speaker-next]");
    const notesSlot = doc.querySelector("[data-speaker-notes]");
    const counterSlot = doc.querySelector("[data-speaker-counter]");
    const titleSlot = doc.querySelector("[data-speaker-title]");
    const nextTitleSlot = doc.querySelector("[data-speaker-next-title]");
    const progressSlot = doc.querySelector("[data-speaker-progress]");
    const timerSlot = doc.querySelector("[data-speaker-timer]");
    const nextIndex = Math.min(currentIndex + 1, slides.length - 1);

    if (currentSlot) currentSlot.innerHTML = stripNotesFromSlideHtml(slides[currentIndex]);
    if (nextSlot) nextSlot.innerHTML = stripNotesFromSlideHtml(slides[nextIndex]);
    if (notesSlot) notesSlot.textContent = getSlideNotes(currentIndex);
    if (counterSlot) counterSlot.textContent = `${currentIndex + 1} / ${slides.length}`;
    if (titleSlot) titleSlot.textContent = getSlideTitle(currentIndex);
    if (nextTitleSlot) nextTitleSlot.textContent = nextIndex === currentIndex ? "End" : getSlideTitle(nextIndex);
    if (progressSlot) progressSlot.style.width = `${((currentIndex + 1) / slides.length) * 100}%`;
    if (timerSlot) timerSlot.textContent = formatElapsed(Date.now() - startedAt);
  }

  function openSpeakerView() {
    speakerWindow = window.open("", "html-ppt-speaker", "width=1200,height=760");
    if (!speakerWindow) {
      showToolStatus("浏览器阻止了演讲者视图弹窗");
      return;
    }

    const baseHref = document.baseURI.replace(/"/g, "%22");
    const currentPreviewWidth = 640;
    const currentPreviewHeight = currentPreviewWidth * (slideHeight / slideWidth);
    const currentPreviewScale = currentPreviewWidth / slideWidth;
    const nextPreviewWidth = 320;
    const nextPreviewHeight = nextPreviewWidth * (slideHeight / slideWidth);
    const nextPreviewScale = nextPreviewWidth / slideWidth;

    speakerWindow.document.open();
    speakerWindow.document.write(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <base href="${baseHref}" />
  <title>Speaker View</title>
  <link rel="stylesheet" href="./style.css" />
  <style>
    :root { --slide-width: ${slideWidth}px; --slide-height: ${slideHeight}px; }
    body { margin: 0; background: #111827; color: #e5e7eb; font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif; }
    .speaker-shell { display: grid; grid-template-columns: 1.45fr 0.9fr; gap: 18px; height: 100vh; padding: 18px; }
    .speaker-main, .speaker-side, .speaker-notes { border: 1px solid #334155; border-radius: 8px; background: #0f172a; }
    .speaker-main { display: grid; grid-template-rows: auto 1fr; min-width: 0; }
    .speaker-head { display: flex; justify-content: space-between; gap: 16px; padding: 14px 16px; border-bottom: 1px solid #334155; }
    .speaker-title { font-size: 18px; font-weight: 800; }
    .speaker-meta { color: #93c5fd; font-size: 16px; font-weight: 800; }
    .speaker-preview { position: relative; align-self: start; width: ${currentPreviewWidth}px; height: ${currentPreviewHeight}px; margin: 18px auto; overflow: hidden; background: #fff; }
    .speaker-preview .slide { position: absolute; top: 0; left: 0; box-shadow: none; transform: scale(${currentPreviewScale}); transform-origin: top left; }
    .speaker-preview .slide.active { display: var(--slide-display); }
    .speaker-side { display: grid; grid-template-rows: auto auto 1fr; gap: 16px; padding: 16px; min-width: 0; }
    .speaker-timer { font-size: 34px; font-weight: 900; color: #fff; }
    .speaker-progress { height: 8px; overflow: hidden; border-radius: 999px; background: #334155; }
    .speaker-progress span { display: block; width: 0%; height: 100%; background: linear-gradient(90deg, #2f6fed, #00a6c8); }
    .speaker-next-label { margin: 0 0 10px; color: #cbd5e1; font-size: 14px; font-weight: 800; }
    .speaker-next-preview { position: relative; width: ${nextPreviewWidth}px; height: ${nextPreviewHeight}px; overflow: hidden; background: #fff; }
    .speaker-next-preview .slide { position: absolute; top: 0; left: 0; box-shadow: none; transform: scale(${nextPreviewScale}); transform-origin: top left; }
    .speaker-next-preview .slide.active { display: var(--slide-display); }
    .speaker-notes { padding: 16px; color: #f8fafc; font-size: 22px; line-height: 1.48; white-space: pre-wrap; }
    .speaker-controls { display: flex; gap: 10px; margin-top: 12px; }
    .speaker-controls button { padding: 8px 12px; border: 0; border-radius: 6px; background: #2563eb; color: #fff; cursor: pointer; font-weight: 800; }
  </style>
</head>
<body>
  <div class="speaker-shell">
    <section class="speaker-main">
      <div class="speaker-head">
        <div>
          <div class="speaker-title" data-speaker-title></div>
          <div class="speaker-meta" data-speaker-counter></div>
        </div>
        <div class="speaker-timer" data-speaker-timer>00:00</div>
      </div>
      <div class="speaker-preview" data-speaker-current></div>
    </section>
    <aside class="speaker-side">
      <div class="speaker-progress"><span data-speaker-progress></span></div>
      <div>
        <p class="speaker-next-label">Next: <span data-speaker-next-title></span></p>
        <div class="speaker-next-preview" data-speaker-next></div>
      </div>
      <div>
        <p class="speaker-next-label">Notes</p>
        <div class="speaker-notes" data-speaker-notes></div>
        <div class="speaker-controls">
          <button onclick="opener.Presenter.prev()">Prev</button>
          <button onclick="opener.Presenter.next()">Next</button>
          <button onclick="opener.Presenter.resetTimer()">Reset Timer</button>
        </div>
      </div>
    </aside>
  </div>
</body>
</html>`);
    speakerWindow.document.close();
    speakerWindow.focus();
    updateSpeakerView();
  }

  function updatePresenterScale() {
    if (!document.body.classList.contains(presentingClass)) {
      document.documentElement.style.setProperty("--presenter-scale", "1");
      return;
    }

    const scaleX = window.innerWidth / slideWidth;
    const scaleY = window.innerHeight / slideHeight;
    const scale = Math.min(scaleX, scaleY);

    document.documentElement.style.setProperty("--presenter-scale", String(scale));
  }

  function setActiveSlide(index, options = {}) {
    currentIndex = clamp(index);
    slides.forEach((slide, slideIndex) => {
      slide.classList.toggle(activeClass, slideIndex === currentIndex);
    });

    updateDocumentTitle();

    if (options.updateHash !== false) {
      updateHash(currentIndex);
    }

    updateThumbnails();
    updateProgress();
    updateSpeakerView();

    // 普通浏览模式下，hash 定位应滚动到对应页面；演讲模式下只切换当前页。
    if (!document.body.classList.contains(presentingClass) && options.scroll !== false) {
      slides[currentIndex].scrollIntoView({ block: "center" });
    }
  }

  function restoreNormalView() {
    document.body.classList.remove(presentingClass);
    updatePresenterScale();
    setActiveSlide(currentIndex);
  }

  async function start() {
    if (isEditMode()) {
      disableEditMode();
    }

    document.body.classList.add(presentingClass);
    updatePresenterScale();
    setActiveSlide(currentIndex, { scroll: false });

    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    }

    updatePresenterScale();
  }

  async function stop() {
    restoreNormalView();

    if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  }

  async function toggle() {
    if (document.body.classList.contains(presentingClass)) {
      await stop();
    } else {
      await start();
    }
  }

  function next() {
    setActiveSlide(currentIndex + 1);
  }

  function prev() {
    setActiveSlide(currentIndex - 1);
  }

  function goTo(index) {
    setActiveSlide(index);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  function copyComputedStyles(source, target) {
    const computed = window.getComputedStyle(source);
    const styleText = Array.from({ length: computed.length }, (_, index) => {
      const property = computed[index];
      return `${property}:${computed.getPropertyValue(property)};`;
    }).join("");

    target.setAttribute("style", styleText);

    Array.from(source.children).forEach((sourceChild, index) => {
      const targetChild = target.children[index];
      if (targetChild) {
        copyComputedStyles(sourceChild, targetChild);
      }
    });
  }

  function prepareExportClone(slide) {
    const clone = slide.cloneNode(true);
    clone.classList.add(activeClass);
    copyComputedStyles(slide, clone);
    clone.querySelectorAll(".notes").forEach((note) => note.remove());
    clone.style.boxShadow = "none";
    clone.style.margin = "0";
    clone.style.transform = "none";
    clone.style.display = window.getComputedStyle(slide).display;
    return clone;
  }

  async function renderSlideToJpeg(slide) {
    const clone = prepareExportClone(slide);

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${slideWidth}" height="${slideHeight}" viewBox="0 0 ${slideWidth} ${slideHeight}">
  <foreignObject width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${slideWidth}px;height:${slideHeight}px;margin:0;background:#fff;overflow:hidden;">
      ${clone.outerHTML}
    </div>
  </foreignObject>
</svg>`;

    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

    const image = await loadImage(svgUrl);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const exportScale = 2;

    canvas.width = Math.round(slideWidth * exportScale);
    canvas.height = Math.round(slideHeight * exportScale);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(exportScale, exportScale);
    context.drawImage(image, 0, 0, slideWidth, slideHeight);

    return canvas.toDataURL("image/jpeg", 0.94);
  }

  function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.split(",")[1];
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  }

  function textBytes(text) {
    return new TextEncoder().encode(text);
  }

  function concatBytes(chunks, totalLength) {
    const output = new Uint8Array(totalLength);
    let offset = 0;

    chunks.forEach((chunk) => {
      output.set(chunk, offset);
      offset += chunk.length;
    });

    return output;
  }

  function buildPdfFromJpegs(jpegDataUrls) {
    const chunks = [];
    const offsets = [];
    let length = 0;
    const pageWidth = slideWidth;
    const pageHeight = slideHeight;
    const maxObjectId = 2 + jpegDataUrls.length * 3;

    function appendBytes(bytes) {
      chunks.push(bytes);
      length += bytes.length;
    }

    function appendText(text) {
      appendBytes(textBytes(text));
    }

    function beginObject(id) {
      offsets[id] = length;
      appendText(`${id} 0 obj\n`);
    }

    appendText("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n");

    beginObject(1);
    appendText("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

    beginObject(2);
    const kids = jpegDataUrls.map((_, index) => `${3 + index * 3} 0 R`).join(" ");
    appendText(`<< /Type /Pages /Kids [${kids}] /Count ${jpegDataUrls.length} >>\nendobj\n`);

    jpegDataUrls.forEach((dataUrl, index) => {
      const pageObjectId = 3 + index * 3;
      const imageObjectId = pageObjectId + 1;
      const contentObjectId = pageObjectId + 2;
      const imageName = `Im${index + 1}`;
      const jpegBytes = dataUrlToBytes(dataUrl);
      const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/${imageName} Do\nQ\n`;

      beginObject(pageObjectId);
      appendText(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /${imageName} ${imageObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>\nendobj\n`);

      beginObject(imageObjectId);
      appendText(`<< /Type /XObject /Subtype /Image /Width ${Math.round(pageWidth * 2)} /Height ${Math.round(pageHeight * 2)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
      appendBytes(jpegBytes);
      appendText("\nendstream\nendobj\n");

      beginObject(contentObjectId);
      appendText(`<< /Length ${textBytes(content).length} >>\nstream\n${content}endstream\nendobj\n`);
    });

    const xrefOffset = length;
    appendText(`xref\n0 ${maxObjectId + 1}\n`);
    appendText("0000000000 65535 f \n");

    for (let id = 1; id <= maxObjectId; id += 1) {
      appendText(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
    }

    appendText(`trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

    return concatBytes(chunks, length);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportPdf() {
    showToolStatus("正在生成 PDF...");

    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    await new Promise((resolve) => requestAnimationFrame(resolve));

    try {
      const jpegDataUrls = [];

      for (const slide of slides) {
        jpegDataUrls.push(await renderSlideToJpeg(slide));
      }

      const pdfBytes = buildPdfFromJpegs(jpegDataUrls);
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      downloadBlob(blob, "html-ppt.pdf");
      showToolStatus("PDF 已生成");
    } catch (error) {
      console.error(error);
      window.alert("PDF 导出失败：当前浏览器可能不支持 foreignObject 渲染，或页面包含跨域图片。");
    }
  }

  function isEditMode() {
    return document.body.classList.contains(editingClass);
  }

  function supportsFileSystemAccess() {
    return typeof window.showSaveFilePicker === "function";
  }

  function updateEditorUi() {
    if (!editorButtons.edit) return;

    editorButtons.edit.textContent = isEditMode() ? "退出编辑" : "编辑文字";
    editorButtons.edit.classList.toggle(activeClass, isEditMode());
    editorButtons.save.textContent = isDirty ? "保存 HTML *" : "保存 HTML";
    editorButtons.save.title = supportsFileSystemAccess()
      ? "保存当前 HTML 文件"
      : "当前浏览器不支持 File System Access API";
  }

  function getEditableElements() {
    return slides.flatMap((slide) => Array.from(slide.querySelectorAll(editableSelector)));
  }

  function setEditableAttributes(enabled) {
    getEditableElements().forEach((element) => {
      if (enabled) {
        element.setAttribute("contenteditable", "plaintext-only");
        element.setAttribute("spellcheck", "false");
        element.setAttribute("data-editable", "true");
      } else {
        element.removeAttribute("contenteditable");
        element.removeAttribute("spellcheck");
        element.removeAttribute("data-editable");
      }
    });
  }

  function syncSlideDataTitle(slide) {
    const heading = slide.querySelector("h1, h2");
    const title = heading?.textContent.trim();
    if (title) {
      slide.dataset.title = title;
    }
  }

  async function enableEditMode() {
    if (document.body.classList.contains(presentingClass)) {
      await stop();
    }

    document.body.classList.remove(laserClass, penClass);
    clearInk();
    document.body.classList.add(editingClass);
    setEditableAttributes(true);
    updateEditorUi();
    showToolStatus("编辑模式已开启");
  }

  function disableEditMode() {
    setEditableAttributes(false);
    document.body.classList.remove(editingClass);
    updateEditorUi();
    showToolStatus("编辑模式已关闭");
  }

  async function toggleEditMode() {
    if (isEditMode()) {
      disableEditMode();
      return;
    }

    await enableEditMode();
  }

  function markDirty(slide, changedElement) {
    const index = slides.indexOf(slide);
    if (index < 0) return;

    if (changedElement?.matches("h1, h2")) {
      syncSlideDataTitle(slide);
    }

    isDirty = true;
    refreshThumbnail(index);
    updateDocumentTitle();
    updateSpeakerView();
    updateEditorUi();
  }

  function handleEditableInput(event) {
    if (!isEditMode()) return;

    const target = event.target.closest("[data-editable='true']");
    const slide = target?.closest(".slide");
    if (!target || !slide || !deck.contains(slide)) return;

    markDirty(slide, target);
  }

  function normalizeRuntimeArtifacts(root) {
    root.removeAttribute("style");
    root.querySelector(".presenter-sidebar")?.remove();
    clearEditableAttributes(root);

    const body = root.querySelector("body");
    if (body) {
      body.classList.remove(presentingClass, laserClass, penClass, editingClass);
      if (!body.getAttribute("class")) {
        body.removeAttribute("class");
      }
    }

    root.querySelectorAll(".slide").forEach((slide) => {
      slide.classList.remove(activeClass);
    });

    const progress = root.querySelector(".presenter-progress span");
    if (progress) {
      progress.removeAttribute("style");
    }

    const tool = root.querySelector(".tool-status");
    if (tool) {
      tool.textContent = "";
      tool.classList.remove("visible");
    }

    const canvas = root.querySelector(".ink-layer");
    if (canvas) {
      canvas.removeAttribute("width");
      canvas.removeAttribute("height");
      canvas.removeAttribute("style");
    }
  }

  function serializeCurrentHtml() {
    const root = document.documentElement.cloneNode(true);
    normalizeRuntimeArtifacts(root);
    return `<!DOCTYPE html>\n${root.outerHTML}\n`;
  }

  function assertFileSystemAccessSupport() {
    if (supportsFileSystemAccess()) return;

    throw new Error("当前浏览器不支持 File System Access API。请使用 Chrome 或 Edge 打开此 HTML。");
  }

  async function pickSaveHandle(suggestedName = "index.html") {
    assertFileSystemAccessSupport();

    return window.showSaveFilePicker({
      suggestedName,
      types: [
        {
          description: "HTML file",
          accept: {
            "text/html": [".html", ".htm"],
          },
        },
      ],
      excludeAcceptAllOption: false,
    });
  }

  async function requestWritablePermission(handle) {
    if (!handle.queryPermission || !handle.requestPermission) {
      return true;
    }

    const options = { mode: "readwrite" };
    if (await handle.queryPermission(options) === "granted") {
      return true;
    }

    return await handle.requestPermission(options) === "granted";
  }

  async function writeHtml(handle) {
    if (!await requestWritablePermission(handle)) {
      throw new Error("没有写入该 HTML 文件的权限。");
    }

    const writable = await handle.createWritable();
    await writable.write(serializeCurrentHtml());
    await writable.close();
  }

  async function saveHtml() {
    try {
      if (!fileHandle) {
        fileHandle = await pickSaveHandle();
      }

      await writeHtml(fileHandle);
      isDirty = false;
      updateEditorUi();
      showToolStatus("HTML 已保存");
    } catch (error) {
      if (error.name === "AbortError") {
        showToolStatus("已取消保存");
        return;
      }

      console.error(error);
      window.alert(error.message || "HTML 保存失败。");
    }
  }

  function resetTimer() {
    startedAt = Date.now();
    updateSpeakerView();
  }

  function showToolStatus(message) {
    if (!toolStatus) return;
    toolStatus.textContent = message;
    toolStatus.classList.add("visible");
    window.clearTimeout(showToolStatus.timer);
    showToolStatus.timer = window.setTimeout(() => {
      toolStatus.classList.remove("visible");
    }, 1200);
  }

  function resizeInkLayer() {
    if (!inkLayer) return;
    const ratio = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    inkLayer.width = Math.floor(width * ratio);
    inkLayer.height = Math.floor(height * ratio);
    inkLayer.style.width = `${width}px`;
    inkLayer.style.height = `${height}px`;
    const context = inkLayer.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 4;
    context.strokeStyle = "#ef4444";
  }

  function clearInk() {
    if (!inkLayer) return;
    inkLayer.getContext("2d").clearRect(0, 0, inkLayer.width, inkLayer.height);
  }

  function toggleLaser() {
    document.body.classList.toggle(laserClass);
    if (document.body.classList.contains(laserClass)) {
      document.body.classList.remove(penClass);
      showToolStatus("激光笔已开启");
    } else {
      showToolStatus("激光笔已关闭");
    }
  }

  function togglePen() {
    document.body.classList.toggle(penClass);
    if (document.body.classList.contains(penClass)) {
      document.body.classList.remove(laserClass);
      resizeInkLayer();
      showToolStatus("画笔已开启，按 C 清除");
    } else {
      showToolStatus("画笔已关闭");
    }
  }

  function handleKeydown(event) {
    const key = event.key;
    const isEditableTarget = event.target.closest?.("[data-editable='true']");

    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "s") {
      event.preventDefault();
      saveHtml();
      return;
    }

    if (isEditableTarget) {
      if (key === "Escape") {
        event.preventDefault();
        event.target.blur();
      }

      return;
    }

    if (key.toLowerCase() === "e") {
      event.preventDefault();
      toggleEditMode();
      return;
    }

    if (key === "ArrowRight" || key === "PageDown" || key === " ") {
      event.preventDefault();
      next();
      return;
    }

    if (key === "ArrowLeft" || key === "PageUp") {
      event.preventDefault();
      prev();
      return;
    }

    if (key === "Home") {
      event.preventDefault();
      goTo(0);
      return;
    }

    if (key === "End") {
      event.preventDefault();
      goTo(slides.length - 1);
      return;
    }

    if (key.toLowerCase() === "f") {
      event.preventDefault();
      toggle();
      return;
    }

    if (key.toLowerCase() === "v") {
      event.preventDefault();
      openSpeakerView();
      return;
    }

    if (key.toLowerCase() === "l") {
      event.preventDefault();
      toggleLaser();
      return;
    }

    if (key.toLowerCase() === "d") {
      event.preventDefault();
      togglePen();
      return;
    }

    if (key.toLowerCase() === "c") {
      event.preventDefault();
      clearInk();
      showToolStatus("画笔已清除");
    }
  }

  function handleSlideClick(event) {
    const slide = event.currentTarget;
    const index = slides.indexOf(slide);

    if (index < 0 || event.button !== 0) return;

    if (!document.body.classList.contains(presentingClass)) {
      return;
    }

    if (document.body.classList.contains(penClass)) {
      return;
    }

    const rect = slide.getBoundingClientRect();
    const isRightHalf = event.clientX >= rect.left + rect.width / 2;

    if (isRightHalf) {
      next();
    } else {
      prev();
    }
  }

  function handleWheel(event) {
    if (!document.body.classList.contains(presentingClass)) {
      return;
    }

    event.preventDefault();

    const rawDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
      ? event.deltaY
      : event.deltaX;
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 18
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? window.innerHeight
        : 1;
    const delta = rawDelta * unit;

    if (delta === 0) {
      return;
    }

    if (wheelDeltaBuffer !== 0 && Math.sign(wheelDeltaBuffer) !== Math.sign(delta)) {
      wheelDeltaBuffer = 0;
    }

    wheelDeltaBuffer += delta;

    window.clearTimeout(wheelResetTimer);
    wheelResetTimer = window.setTimeout(() => {
      wheelDeltaBuffer = 0;
    }, wheelResetDelayMs);

    const rawSteps = Math.trunc(Math.abs(wheelDeltaBuffer) / wheelStepSize);
    if (rawSteps === 0) {
      return;
    }

    const steps = Math.min(rawSteps, maxWheelStepsPerEvent);
    const direction = Math.sign(wheelDeltaBuffer);
    wheelDeltaBuffer -= direction * steps * wheelStepSize;

    for (let step = 0; step < steps; step += 1) {
      if (direction > 0) {
        next();
      } else {
        prev();
      }
    }
  }

  function handleHashchange() {
    const index = hashToIndex(window.location.hash);
    if (index !== null) {
      setActiveSlide(index, { updateHash: false });
    }
  }

  function handlePointerMove(event) {
    if (!laserPointer || !document.body.classList.contains(laserClass)) return;
    laserPointer.style.left = `${event.clientX}px`;
    laserPointer.style.top = `${event.clientY}px`;
  }

  function startInk(event) {
    if (!document.body.classList.contains(penClass)) return;
    event.preventDefault();
    isDrawing = true;
    lastInkPoint = { x: event.clientX, y: event.clientY };
    inkLayer.setPointerCapture(event.pointerId);
  }

  function drawInk(event) {
    if (!isDrawing || !lastInkPoint) return;
    event.preventDefault();
    const context = inkLayer.getContext("2d");
    context.beginPath();
    context.moveTo(lastInkPoint.x, lastInkPoint.y);
    context.lineTo(event.clientX, event.clientY);
    context.stroke();
    lastInkPoint = { x: event.clientX, y: event.clientY };
  }

  function stopInk(event) {
    if (!isDrawing) return;
    event.preventDefault();
    isDrawing = false;
    lastInkPoint = null;
  }

  function init() {
    readSlideSize();
    buildThumbnails();

    const hashIndex = hashToIndex(window.location.hash);
    setActiveSlide(hashIndex ?? 0, {
      updateHash: hashIndex === null,
      scroll: hashIndex !== null,
    });

    document.addEventListener("keydown", handleKeydown);
    document.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("hashchange", handleHashchange);
    window.addEventListener("beforeunload", (event) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
    window.addEventListener("resize", () => {
      updatePresenterScale();
      resizeInkLayer();
    });
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement) {
        restoreNormalView();
      }
    });

    if (inkLayer) {
      resizeInkLayer();
      inkLayer.addEventListener("pointerdown", startInk);
      inkLayer.addEventListener("pointermove", drawInk);
      inkLayer.addEventListener("pointerup", stopInk);
      inkLayer.addEventListener("pointercancel", stopInk);
    }

    deck.addEventListener("input", handleEditableInput);
    window.setInterval(updateSpeakerView, 1000);

    slides.forEach((slide) => {
      slide.addEventListener("click", handleSlideClick);
    });
  }

  window.Presenter = {
    start,
    stop,
    toggle,
    next,
    prev,
    goTo,
    exportPdf,
    openSpeakerView,
    resetTimer,
    toggleLaser,
    togglePen,
    clearInk,
    toggleEditMode,
    saveHtml,
    get index() {
      return currentIndex;
    },
    get total() {
      return slides.length;
    },
  };

  init();
})();
