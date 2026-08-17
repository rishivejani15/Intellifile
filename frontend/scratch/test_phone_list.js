const { exec } = require('child_process');

const targetName = 'Redmi Note 6 Pro';

const psCmd = `
$sh = New-Object -ComObject Shell.Application
$thisPC = $sh.Namespace(17)
$device = $thisPC.Items() | Where-Object { $_.Name -like "*${targetName}*" } | Select-Object -First 1
if ($device) {
  $storageFolder = $device.GetFolder
  if ($storageFolder) {
    $items = @()
    foreach ($sub in $storageFolder.Items()) {
      $items += [PSCustomObject]@{
        name = $sub.Name
        path = $sub.Path
        type = $(if ($sub.IsFolder) { "folder" } else { "file" })
        size = $sub.Size
      }
    }
    $items | ConvertTo-Json
  }
}
`;

exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCmd.replace(/\n/g, '; ')}"`, (err, stdout, stderr) => {
  if (err) {
    console.error('Error:', err.message);
    return;
  }
  console.log('Items inside Redmi Note 6 Pro:');
  console.log(stdout);
});
