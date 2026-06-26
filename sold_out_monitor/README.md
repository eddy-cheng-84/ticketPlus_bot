# Sold Out Monitor

主要說明請看 `README.txt`。

這個資料夾是 Ticket Plus 活動頁售完監控器。預設使用 Windows 11 內建的 Microsoft Edge：

```json
"browser_channel": "msedge"
```

正常使用：

```bat
start-monitor.bat
```

單次測試：

```bat
dist\sold_out_monitor.exe --config monitor_config.json --once
```

重新打包：

```bat
build-exe.bat
```
