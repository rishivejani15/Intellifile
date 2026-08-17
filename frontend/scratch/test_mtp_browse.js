const { execSync } = require('child_process');

try {
  const psCmd = `
$sh = New-Object -ComObject Shell.Application
$thisPC = $sh.Namespace(17)
$phone = $thisPC.Items() | Where-Object { $_.Name -like "*Redmi*" -or $_.Type -eq "Portable Device" } | Select-Object -First 1
if ($phone) {
  Write-Output "Found Phone: $($phone.Name) | Path: $($phone.Path)"
  $phoneFolder = $phone.GetFolder
  if ($phoneFolder) {
    Write-Output "Storage sub-items:"
    foreach ($item in $phoneFolder.Items()) {
      Write-Output " - $($item.Name) | Size: $($item.Size) | Type: $($item.Type)"
    }
  }
} else {
  Write-Output "Phone not found in Namespace 17"
}
`;
  const out = execSync(`powershell -NoProfile -Command "${psCmd.replace(/\n/g, '; ')}"`, { encoding: 'utf8' });
  console.log(out);
} catch (e) {
  console.error('Error:', e.message);
}
