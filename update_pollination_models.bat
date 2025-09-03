:: by OreX
:: Homepage: https://stabledif.ru
:: Telegram: https://t.me/stable_dif

@echo off
cls
setlocal enabledelayedexpansion
chcp 65001>null
color 0F
del null

setlocal ENABLEEXTENSIONS
set "TARGET_FILE=polination_text_llm.json"
set "TMP_RAW=tmp_pollination_raw.json"
set "TMP_FORMATTED=tmp_pollination_formatted.json"

echo Запрос к API Pollinations...
curl -s https://text.pollinations.ai/models > "%TMP_RAW%"

:: Проверка: файл существует и не пуст
for %%F in ("%TMP_RAW%") do (
    if %%~zF EQU 0 (
        echo [ОШИБКА] Получен пустой ответ. Файл не будет обновлён.
        del "%TMP_RAW%"
        exit /b 1
    )
)

:: Поиск ошибок в ответе
findstr /i /c:"error" "%TMP_RAW%" >nul
if %errorlevel%==0 (
    echo [ОШИБКА] В ответе найдена строка "error". Файл не будет обновлён.
    del "%TMP_RAW%"
    exit /b 1
)

:: Форматирование JSON через Python
echo Форматирование JSON...
python -m json.tool "%TMP_RAW%" > "%TMP_FORMATTED%" 2>nul
if %errorlevel% NEQ 0 (
    echo [ОШИБКА] Некорректный JSON. Файл не будет обновлён.
    del "%TMP_RAW%"
    del "%TMP_FORMATTED%"
    exit /b 1
)

:: Перемещение отформатированного файла
move /Y "%TMP_FORMATTED%" "%TARGET_FILE%" >nul
del "%TMP_RAW%"
echo [OK] Файл %TARGET_FILE% успешно обновлён и отформатирован.

endlocal
