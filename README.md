# PointMeasure 3D

PointMeasure 3D is a Windows desktop app for importing PLY point-cloud scans and measuring office/interior spaces in a 3D viewer.

This repository contains the source code. The Windows installer is provided separately through GitHub Releases.

## Download

For normal testing, download the latest installer from:

https://github.com/yfan62858/PointMeasure-3D/releases

Current test build:

- `PointMeasure-3D-Setup-0.1.17.exe`

After installing, open PointMeasure 3D and import a `.ply` point cloud.

## Quick Start

1. Download the latest installer from GitHub Releases.
2. Install and open PointMeasure 3D.
3. Click `匯入 PLY` to load a `.ply` point cloud.
4. Click `重設視角` to frame the loaded point cloud.
5. Use `距離量測` for point-to-point distances or `梁柱量測` for structural dimensions.
6. Click `平面圖` to generate a floorplan with wall lengths. Confirm the up axis and input unit; use `重新產生` after changing either setting.
7. In the floorplan panel, use the mouse wheel to zoom and drag to pan. Export PNG, SVG, CSV, DXF, or JSON with the corresponding button.

Sample scan data is not included in this public repository. Use your own `.ply` file or scan folder for testing.

## Features

- Import standalone PLY point clouds.
- View point clouds with Three.js.
- Measure distance between 3D points.
- Measure planes and estimate width, height, and area.
- Generate a local floorplan draft with wall lengths from the imported PLY.
- Overlay point-cloud evidence and review uncertain boundary segments.
- Zoom and pan the floorplan; export PNG, SVG, CSV, DXF, and JSON.

## Development

Requirements:

- Node.js 20+
- npm

Install dependencies:

```powershell
npm install
```

Run the app in development mode:

```powershell
npm run dev
```

Build the app:

```powershell
npm run build
```

Create a Windows installer:

```powershell
npm run dist
```

Check a PLY file:

```powershell
npm run check:ply -- "path\to\pointcloud.ply"
```

## Repository Notes

The repository intentionally excludes local scan data, generated build output, dependency folders, logs, and installer artifacts.

Do not commit real office scans, customer data, private paths, API keys, credentials, or generated release files. Put public installer builds in GitHub Releases instead.

## License

MIT License. See `LICENSE`.

## App 自動平面圖（2026-09-18）
匯入 PLY 後點「平面圖」，直接從該檔案讀取 XYZ，背景執行高度估計、方向對齊、多高度牆面提取、外框整理及長度計算。預設含牆長，支援 PNG/SVG/CSV/DXF/JSON 匯出、點雲證據疊圖及取消／重試。不讀取預製圖片、掃描白名單或封存 AI 外框；不需 Python、網路或模型 API。

設定：向上軸 Y（ARKit）或 Z；單位公尺／公分／毫米。PLY 本身通常未記錄這些設定。輸入支援 ASCII、binary little/big endian 的標準 scalar XYZ 頂點；內部最多約120萬點取樣。適用單層、主要正交室內空間。主連通區外框是自動提案，未觀測連接以低支持虛線表示；未恢復所有內牆、門窗、牆厚，也不保證工程精度。

主程式 `src/main/FloorplanService.ts` 啟動打包後的 `floorplan-worker.cjs`。演算法在 `src/main/floorplan/`，UI 為 `src/renderer/FloorplanPanel.ts`。正式包只帶程式，不帶私人掃描或舊研究成果。每次產圖均重新讀取目前檔案，不依檔名或舊快取。

驗證：`npm run build`、`npm run check:floorplan-geometry`、`npm run check:floorplan-service`。整合測試以 `FLOORPLAN_TEST_PLY` 指定本機 15,935,774 點測試資料，再執行 `npm run check:floorplan-system`，驗證即時計算、預設尺寸、五格式匯出、縮放拖曳與取消重試；測試資料不隨 repo 發布。
