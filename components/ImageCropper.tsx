'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import styles from './ImageCropper.module.css';

type Area = { x: number; y: number; width: number; height: number };

function getCroppedImg(imageSrc: string, pixelCrop: Area): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }
      canvas.width = pixelCrop.width;
      canvas.height = pixelCrop.height;
      ctx.drawImage(
        image,
        pixelCrop.x,
        pixelCrop.y,
        pixelCrop.width,
        pixelCrop.height,
        0,
        0,
        pixelCrop.width,
        pixelCrop.height
      );
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    });
    image.addEventListener('error', () => reject(new Error('Image load error')));
    image.src = imageSrc;
  });
}

const ASPECT_RATIOS = [
  { label: 'Free', value: undefined },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '16:9', value: 16 / 9 },
  { label: '3:4', value: 3 / 4 },
  { label: '9:16', value: 9 / 16 },
];

type Handle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

const HANDLES: Handle[] = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];

const HANDLE_CURSORS: Record<Handle, string> = {
  n: 'n-resize',
  s: 's-resize',
  e: 'e-resize',
  w: 'w-resize',
  nw: 'nw-resize',
  ne: 'ne-resize',
  sw: 'sw-resize',
  se: 'se-resize',
};

export default function ImageCropper() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [croppedImage, setCroppedImage] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<number | undefined>(undefined);
  const [selectedRatioLabel, setSelectedRatioLabel] = useState<string>('Free');
  const [zoom, setZoom] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  // Crop box state in canvas-pixel coordinates
  const [cropBox, setCropBox] = useState({ x: 50, y: 50, width: 200, height: 200 });

  // Drag state
  const dragState = useRef<null | {
    type: 'move' | Handle;
    startMouseX: number;
    startMouseY: number;
    startBox: { x: number; y: number; width: number; height: number };
  }>(null);

  const canvasSize = { width: 700, height: 450 };

  // Draw everything onto the canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageRef.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width: cw, height: ch } = canvasSize;
    ctx.clearRect(0, 0, cw, ch);

    // Draw image centered with zoom & rotation
    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(zoom, zoom);
    const img = imageRef.current;
    const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
    const iw = img.naturalWidth * scale;
    const ih = img.naturalHeight * scale;
    ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
    ctx.restore();

    // Dark overlay
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, cw, ch);
    // Cut out the crop area
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(cropBox.x, cropBox.y, cropBox.width, cropBox.height);
    ctx.restore();

    // Redraw image clipped to crop area so it appears bright
    ctx.save();
    ctx.beginPath();
    ctx.rect(cropBox.x, cropBox.y, cropBox.width, cropBox.height);
    ctx.clip();
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(zoom, zoom);
    {
      const img2 = imageRef.current;
      const scale2 = Math.min(cw / img2.naturalWidth, ch / img2.naturalHeight);
      const iw2 = img2.naturalWidth * scale2;
      const ih2 = img2.naturalHeight * scale2;
      ctx.drawImage(img2, -iw2 / 2, -ih2 / 2, iw2, ih2);
    }
    ctx.restore();

    // Crop border
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(cropBox.x, cropBox.y, cropBox.width, cropBox.height);

    // Grid lines (rule of thirds)
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {
      const x = cropBox.x + (cropBox.width / 3) * i;
      const y = cropBox.y + (cropBox.height / 3) * i;
      ctx.beginPath();
      ctx.moveTo(x, cropBox.y);
      ctx.lineTo(x, cropBox.y + cropBox.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cropBox.x, y);
      ctx.lineTo(cropBox.x + cropBox.width, y);
      ctx.stroke();
    }
    ctx.restore();

    // Draw handles
    const handleSize = 10;
    const halfHandle = handleSize / 2;
    const handles = getHandlePositions(cropBox);
    HANDLES.forEach((key) => {
      const pos = handles[key];
      ctx.save();
      ctx.fillStyle = '#e94560';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, halfHandle + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });
  }, [cropBox, zoom, rotation, canvasSize]);

  useEffect(() => {
    draw();
  }, [draw]);

  function getHandlePositions(box: typeof cropBox): Record<Handle, { x: number; y: number }> {
    const { x, y, width, height } = box;
    return {
      nw: { x, y },
      n: { x: x + width / 2, y },
      ne: { x: x + width, y },
      w: { x, y: y + height / 2 },
      e: { x: x + width, y: y + height / 2 },
      sw: { x, y: y + height },
      s: { x: x + width / 2, y: y + height },
      se: { x: x + width, y: y + height },
    };
  }

  function hitTestHandle(mx: number, my: number, box: typeof cropBox): Handle | null {
    const handles = getHandlePositions(box);
    const hitRadius = 12;
    for (const key of HANDLES) {
      const pos = handles[key as Handle];
      const dx = mx - pos.x;
      const dy = my - pos.y;
      if (Math.sqrt(dx * dx + dy * dy) <= hitRadius) {
        return key as Handle;
      }
    }
    return null;
  }

  function hitTestMove(mx: number, my: number, box: typeof cropBox): boolean {
    return (
      mx >= box.x && mx <= box.x + box.width &&
      my >= box.y && my <= box.y + box.height
    );
  }

  function getCanvasPos(e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function clampBox(box: { x: number; y: number; width: number; height: number }) {
    const minSize = 20;
    let { x, y, width, height } = box;
    width = Math.max(minSize, width);
    height = Math.max(minSize, height);
    x = Math.max(0, Math.min(x, canvasSize.width - width));
    y = Math.max(0, Math.min(y, canvasSize.height - height));
    if (x + width > canvasSize.width) width = canvasSize.width - x;
    if (y + height > canvasSize.height) height = canvasSize.height - y;
    return { x, y, width, height };
  }

  function applyAspectRatio(
    box: { x: number; y: number; width: number; height: number },
    handle: Handle,
    ratio: number
  ) {
    // Adjust height to match ratio based on width (anchor opposite corner)
    const newHeight = box.width / ratio;
    const diff = newHeight - box.height;
    if (handle.includes('n')) {
      return { ...box, height: newHeight, y: box.y - diff };
    }
    return { ...box, height: newHeight };
  }

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { x, y } = getCanvasPos(e);
      const handle = hitTestHandle(x, y, cropBox);
      if (handle) {
        dragState.current = {
          type: handle,
          startMouseX: x,
          startMouseY: y,
          startBox: { ...cropBox },
        };
        return;
      }
      if (hitTestMove(x, y, cropBox)) {
        dragState.current = {
          type: 'move',
          startMouseX: x,
          startMouseY: y,
          startBox: { ...cropBox },
        };
      }
    },
    [cropBox]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current!;
      const { x, y } = getCanvasPos(e);

      if (!dragState.current) {
        // Update cursor
        const handle = hitTestHandle(x, y, cropBox);
        if (handle) {
          canvas.style.cursor = HANDLE_CURSORS[handle];
        } else if (hitTestMove(x, y, cropBox)) {
          canvas.style.cursor = 'move';
        } else {
          canvas.style.cursor = 'default';
        }
        return;
      }

      const { type, startMouseX, startMouseY, startBox } = dragState.current;
      const dx = x - startMouseX;
      const dy = y - startMouseY;

      if (type === 'move') {
        setCropBox(
          clampBox({
            x: startBox.x + dx,
            y: startBox.y + dy,
            width: startBox.width,
            height: startBox.height,
          })
        );
        return;
      }

      // Handle resize
      let { x: bx, y: by, width: bw, height: bh } = startBox;

      if (type === 'nw') { bx += dx; by += dy; bw -= dx; bh -= dy; }
      else if (type === 'n')  { by += dy; bh -= dy; }
      else if (type === 'ne') { by += dy; bw += dx; bh -= dy; }
      else if (type === 'w')  { bx += dx; bw -= dx; }
      else if (type === 'e')  { bw += dx; }
      else if (type === 'sw') { bx += dx; bw -= dx; bh += dy; }
      else if (type === 's')  { bh += dy; }
      else if (type === 'se') { bw += dx; bh += dy; }

      let newBox = { x: bx, y: by, width: bw, height: bh };

      if (aspectRatio !== undefined) {
        newBox = applyAspectRatio(newBox, type as Handle, aspectRatio);
      }

      setCropBox(clampBox(newBox));
    },
    [cropBox, aspectRatio]
  );

  const handleMouseUp = useCallback(() => {
    dragState.current = null;
  }, []);

  const handleMouseLeave = useCallback(() => {
    dragState.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = 'default';
  }, []);

  // Load image and init crop box
  const loadImage = useCallback((src: string) => {
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setImageNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
      const cw = canvasSize.width;
      const ch = canvasSize.height;
      const initW = Math.round(cw * 0.6);
      const initH = Math.round(ch * 0.6);
      const initX = Math.round((cw - initW) / 2);
      const initY = Math.round((ch - initH) / 2);
      setCropBox({ x: initX, y: initY, width: initW, height: initH });
    };
    img.src = src;
  }, [canvasSize.width, canvasSize.height]);

  const onFileChange = useCallback((file: File) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      setImageSrc(src);
      setCroppedImage(null);
      setZoom(1);
      setRotation(0);
      loadImage(src);
    };
    reader.readAsDataURL(file);
  }, [loadImage]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) onFileChange(e.target.files[0]);
  }, [onFileChange]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) onFileChange(e.dataTransfer.files[0]);
  }, [onFileChange]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const showCroppedImage = useCallback(async () => {
    if (!imageSrc || !imageRef.current) return;
    setIsProcessing(true);
    try {
      const canvas = canvasRef.current!;
      const cw = canvas.width;
      const ch = canvas.height;
      const img = imageRef.current;
      const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight) * zoom;
      const iw = img.naturalWidth * scale;
      const ih = img.naturalHeight * scale;
      const offsetX = cw / 2 - iw / 2;
      const offsetY = ch / 2 - ih / 2;

      // Map cropBox canvas coords to image coords
      const srcX = ((cropBox.x - offsetX) / scale);
      const srcY = ((cropBox.y - offsetY) / scale);
      const srcW = cropBox.width / scale;
      const srcH = cropBox.height / scale;

      const cropped = await getCroppedImg(imageSrc, {
        x: Math.max(0, Math.round(srcX)),
        y: Math.max(0, Math.round(srcY)),
        width: Math.round(srcW),
        height: Math.round(srcH),
      });
      setCroppedImage(cropped);
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  }, [imageSrc, cropBox, zoom]);

  const downloadCroppedImage = useCallback(() => {
    if (!croppedImage) return;
    const link = document.createElement('a');
    link.download = 'cropped-image.jpg';
    link.href = croppedImage;
    link.click();
  }, [croppedImage]);

  const resetAll = useCallback(() => {
    setImageSrc(null);
    setCroppedImage(null);
    setZoom(1);
    setRotation(0);
    imageRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleRatioChange = useCallback((label: string, value: number | undefined) => {
    setSelectedRatioLabel(label);
    setAspectRatio(value);
    if (value !== undefined) {
      setCropBox((prev) => {
        const newH = prev.width / value;
        return clampBox({ x: prev.x, y: prev.y, width: prev.width, height: newH });
      });
    }
  }, []);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerIcon}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
        <h1 className={styles.title}>Image Cropper</h1>
        <p className={styles.subtitle}>Upload, crop, and download your images</p>
      </header>

      <div className={styles.mainContent}>
        {!imageSrc ? (
          <div
            className={`${styles.dropzone} ${isDragging ? styles.dropzoneDragging : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className={styles.dropzoneIcon}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <p className={styles.dropzoneText}>Drag &amp; drop an image here</p>
            <p className={styles.dropzoneSubtext}>or click to browse</p>
            <p className={styles.dropzoneFormats}>Supports JPG, PNG, GIF, WEBP</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileInput}
              className={styles.hiddenInput}
            />
          </div>
        ) : (
          <div className={styles.cropperLayout}>
            <div className={styles.cropperPanel}>
              <div className={styles.cropperWrapper} ref={wrapperRef}>
                <canvas
                  ref={canvasRef}
                  width={canvasSize.width}
                  height={canvasSize.height}
                  className={styles.cropCanvas}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseLeave}
                />
              </div>

              <div className={styles.controls}>
                <div className={styles.controlGroup}>
                  <label className={styles.controlLabel}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      <line x1="11" y1="8" x2="11" y2="14" />
                      <line x1="8" y1="11" x2="14" y2="11" />
                    </svg>
                    Zoom: {zoom.toFixed(1)}x
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.05}
                    value={zoom}
                    onChange={(e) => setZoom(parseFloat(e.target.value))}
                    className={styles.slider}
                  />
                </div>

                <div className={styles.controlGroup}>
                  <label className={styles.controlLabel}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1 4 1 10 7 10" />
                      <path d="M3.51 15a9 9 0 1 0 .49-3.72" />
                    </svg>
                    Rotation: {rotation}°
                  </label>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={1}
                    value={rotation}
                    onChange={(e) => setRotation(parseInt(e.target.value))}
                    className={styles.slider}
                  />
                </div>

                <div className={styles.controlGroup}>
                  <label className={styles.controlLabel}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    </svg>
                    Aspect Ratio
                  </label>
                  <div className={styles.ratioButtons}>
                    {ASPECT_RATIOS.map((r) => (
                      <button
                        key={r.label}
                        className={`${styles.ratioBtn} ${selectedRatioLabel === r.label ? styles.ratioBtnActive : ''}`}
                        onClick={() => handleRatioChange(r.label, r.value)}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className={styles.actionButtons}>
                <button className={styles.resetBtn} onClick={resetAll}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 .49-3.72" />
                  </svg>
                  New Image
                </button>
                <button
                  className={styles.cropBtn}
                  onClick={showCroppedImage}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <span className={styles.spinner} />
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
                      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
                    </svg>
                  )}
                  {isProcessing ? 'Processing...' : 'Crop Image'}
                </button>
              </div>
            </div>

            {croppedImage && (
              <div className={styles.resultPanel}>
                <h2 className={styles.resultTitle}>Cropped Result</h2>
                <div className={styles.resultImageWrapper}>
                  <img src={croppedImage} alt="Cropped" className={styles.resultImage} />
                </div>
                <button className={styles.downloadBtn} onClick={downloadCroppedImage}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download Image
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
