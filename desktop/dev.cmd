@echo off
rem Opens the latest version of the app: rebuilds the page from web\src, then starts the shell.
rem The first run downloads Electron into desktop\node_modules (needs Node 22+ and internet, ~120 MB);
rem after that it works offline. End users never need this: they get the installer from desktop\dist.
cd /d "%~dp0"
if not exist node_modules\electron\dist\electron.exe (
  echo First run: downloading Electron so the app can start...
  call npm install || (echo. && echo npm install failed - is Node installed? && pause && exit /b 1)
)
pushd ..\web
node build.mjs || (echo. && echo The page build failed && pause && exit /b 1)
popd
start "" node_modules\electron\dist\electron.exe .
