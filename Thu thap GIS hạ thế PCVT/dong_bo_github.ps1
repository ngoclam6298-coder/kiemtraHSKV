# Script tự động đồng bộ mã nguồn sang GitHub repository gis_ha_the_pcvt
$source = "e:\Antigraviti_PCVT\Thu thap GIS hạ thế PCVT"
$dest = "C:\Users\EVNHCMCPCPT\.gemini\antigravity-ide\brain\c0018ac6-0893-47c5-acb3-603714c4ca53\scratch\gis_repo"

Copy-Item "$source\index.html" -Destination "$dest\index.html" -Force
Copy-Item "$source\Code.gs" -Destination "$dest\Code.gs" -Force
Copy-Item "$source\HD_TRIEN_KHAI.md" -Destination "$dest\HD_TRIEN_KHAI.md" -Force
Copy-Item "$source\vercel.json" -Destination "$dest\vercel.json" -Force

cd $dest
git add .
git commit -m "Cap nhat ung dung Thu thap GIS"
git push origin main
Write-Host "Đã đồng bộ lên https://github.com/ngoclam6298-coder/gis_ha_the_pcvt thành công!" -ForegroundColor Green
