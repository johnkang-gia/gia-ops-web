@echo off
chcp 65001 >nul
REM GIA 토들 픽업 수집기 - 자동 업데이트 (윈도우용)
REM
REM 더블클릭하면 이 폴더의 파일들을 최신으로 바꿉니다. 폴더를 다시 옮길 필요가 없습니다.
REM 처음 한 번만 운영앱 주소를 물어보고, 그 뒤로는 기억합니다.

cd /d "%~dp0"

echo ════════════════════════════════════════
echo   GIA 토들 픽업 수집기 업데이트
echo ════════════════════════════════════════
echo.

if exist ".server" (
  set /p SERVER=<.server
) else (
  echo 운영앱 주소를 알려주세요.
  echo 예: https://gia-ops-web.vercel.app
  set /p SERVER="주소: "
  if "%SERVER%"=="" (
    echo 주소가 비어 있어 중단합니다.
    pause
    exit /b 1
  )
  echo %SERVER%>.server
)

echo 서버: %SERVER%
echo.
set "BASE=%SERVER%/collector"

REM 임시 폴더에 먼저 받고, 전부 성공했을 때만 덮어씁니다.
set "TMP=%TEMP%\gia-collector-%RANDOM%"
mkdir "%TMP%" 2>nul

set OK=1
for %%F in (manifest.json background.js content.js inject.js popup.html popup.js files.json 설치안내.md 업데이트.command 업데이트.bat) do (
  echo|set /p="  %%F ... "
  curl -fsSL "%BASE%/%%F" -o "%TMP%\%%F" 2>nul
  if errorlevel 1 (
    echo 실패
    set OK=0
  ) else (
    echo 받음
  )
)

if "%OK%"=="0" (
  echo.
  echo [X] 일부 파일을 받지 못해 업데이트하지 않았습니다. 기존 파일은 그대로입니다.
  echo     주소가 맞는지 확인해주세요. 주소를 바꾸시려면 .server 파일을 지우고 다시 실행하세요.
  rmdir /s /q "%TMP%" 2>nul
  pause
  exit /b 1
)

copy /y "%TMP%\*" . >nul
rmdir /s /q "%TMP%" 2>nul

echo.
echo [O] 업데이트를 마쳤습니다.
echo.
echo 마지막 한 단계가 남았습니다:
echo   크롬 주소창에 chrome://extensions 를 치고,
echo   "GIA 토들 픽업 수집기" 카드의 새로고침 아이콘을 눌러주세요.
echo   (크롬을 껐다 켜셔도 됩니다)
echo.
pause
