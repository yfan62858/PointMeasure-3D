# PointMeasure 3D

PointMeasure 3D is a Windows desktop app for importing PLY point-cloud scans and measuring office/interior spaces in a 3D viewer.

This repository contains the source code. The Windows installer is provided separately through GitHub Releases.

## Download

For normal testing, download the latest installer from:

https://github.com/yfan62858/PointMeasure-3D/releases

Current test build:

- `PointMeasure 3D Setup 0.1.1.exe`

After installing, open PointMeasure 3D and import a `.ply` file or a scan folder containing:

```text
pointcloud.ply
metadata.json
roomplan.json        optional
roomplan.usdz        optional
```

## Features

- Import standalone PLY point clouds.
- Import scan folders with `pointcloud.ply` and `metadata.json`.
- View point clouds with Three.js.
- Measure distance between 3D points.
- Measure planes and estimate width, height, and area.
- Display optional RoomPlan overlay data when available.
- Export measurement records as CSV.
- Save modeled measurement surfaces as JSON.

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
