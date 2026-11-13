# Third-party notices

## Browser app

The browser app vendors Three.js r180 (npm version 0.180.0) as
`browser_app/vendor/three.module.min.js`. It is used only for the optional
manual 3D presentation mode; the existing Canvas 2D renderer remains the
fallback. Three.js is licensed under the MIT License. The source project is
https://github.com/mrdoob/three.js, and the full license text is in
[`licenses/THREE-LICENSE`](./licenses/THREE-LICENSE).

All browser runtime resources are local HTML, CSS, JavaScript, and SVG files.
The app does not load external fonts, CDNs, analytics, or hosted scripts.

## Windows build

The Windows build was audited from the installed Python environment used for
the release:

| Package | Installed version | License | Source |
| --- | ---: | --- | --- |
| NumPy | 2.5.4 | BSD-3-Clause and bundled component licenses | https://numpy.org/ |
| PyInstaller | 6.22.3 | GPLv2-or-later with the PyInstaller bootloader exception | https://pyinstaller.org/ |
| altgraph | 0.17.5 | MIT | https://github.com/ronaldoussoren/altgraph |
| packaging | 26.3 | Apache-2.0 and BSD-2-Clause | https://github.com/pypa/packaging |
| pefile | 2024.8.26 | MIT | https://github.com/erocarrera/pefile |
| pyinstaller-hooks-contrib | 2026.9 | Apache-2.0 | https://github.com/pyinstaller/pyinstaller-hooks-contrib |
| pywin32-ctypes | 0.2.3 | BSD-3-Clause | https://github.com/ctypes-win/ctypes |
| setuptools | 84.2.1 | MIT | https://github.com/pypa/setuptools |

The PyInstaller package is a build-time dependency. Its license and exception
must be reviewed by the publisher before distributing a bundled executable.
The installed metadata for some transitive packages is indirect or bundled;
the listed versions and license files were copied from the installed
environment, not inferred from memory.

Full license texts copied from the installed environment are in
[`licenses/`](./licenses/).
