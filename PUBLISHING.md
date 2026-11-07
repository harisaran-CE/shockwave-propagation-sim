# Shockwave Traffic Lab — Windows portable release

## For users

Extract `Flowline-Windows.zip` and double-click
`FlowlineTrafficStudio.exe`. No Python installation or terminal is needed. The
app runs locally and lets you export generated results as CSV or JSON.

## Build the Windows release

On a Windows machine with Python 3.12 installed:

1. Open PowerShell in the project folder.
2. Install build dependencies with `python -m pip install -r requirements-build.txt`.
3. Run `.\build_windows.ps1`.
4. Distribute `dist\Flowline-Windows.zip`.

The build produces a single-file, windowed executable, bundles the numerical
engine and NumPy, adds Windows file/product version metadata, and includes the
license and these user instructions. The executable is a portable build, not a
signed MSI installer. A signed installer can be added when a publisher identity
and installer policy are available.
