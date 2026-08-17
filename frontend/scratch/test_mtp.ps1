$sh = New-Object -ComObject Shell.Application
$thisPC = $sh.Namespace(17)
foreach ($item in $thisPC.Items()) {
  if ($item.Type -eq "Portable Device" -or $item.Name -like "*Redmi*") {
    Write-Host "Found Device: $($item.Name)"
    $subFolder = $item.GetFolder
    if ($subFolder) {
      foreach ($sub in $subFolder.Items()) {
        Write-Host "   Storage: $($sub.Name) | Path: $($sub.Path)"
        $storageFolder = $sub.GetFolder
        if ($storageFolder) {
          $count = 0
          foreach ($f in $storageFolder.Items()) {
            if ($count -lt 10) {
              Write-Host "      Folder: $($f.Name) | isFolder: $($f.IsFolder)"
            }
            $count++
          }
          Write-Host "      Total items in storage: $count"
        }
      }
    }
  }
}
