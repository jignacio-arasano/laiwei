@echo off
cd /d "%~dp0"
del serve.bat
git add -A
git commit -m "Reordenar ejercicios en rutina, fix objetivo de serie con aproximacion/entrada en calor, agregar tipo de serie PAP"
git push
echo.
echo LISTO. Podes cerrar esta ventana.
pause
