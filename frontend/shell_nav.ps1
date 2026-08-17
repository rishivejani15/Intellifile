param(
  [string]$Action,
  [string]$TargetName,
  [string]$SubPath
)

$sh = New-Object -ComObject Shell.Application
$thisPC = $sh.Namespace(17)

if ($Action -eq "list-devices") {
  $devices = @()
  foreach ($item in $thisPC.Items()) {
    if ($item.Type -eq "Portable Device" -or $item.Path -like "::{*") {
      $devices += [PSCustomObject]@{
        name = $item.Name
        path = $item.Name
        type = "portable"
        isPortable = $true
        isRemovable = $true
        device = $item.Name
        description = $item.Name
        size = 0
        available = 0
      }
    }
  }
  if ($devices.Count -gt 0) {
    $devices | ConvertTo-Json -Compress
  } else {
    Write-Output "[]"
  }
  exit 0
}

if ($Action -eq "list-subitems") {
  $found = $thisPC.Items() | Where-Object { $_.Name -eq $TargetName -or $_.Path -eq $TargetName } | Select-Object -First 1
  if (-not $found) {
    Write-Output "[]"
    exit 0
  }
  
  $currFolder = $found.GetFolder
  if ($SubPath) {
    $parts = $SubPath.Split('\', [System.StringSplitOptions]::RemoveEmptyEntries)
    foreach ($part in $parts) {
      if ($currFolder) {
        $next = $currFolder.Items() | Where-Object { $_.Name -eq $part } | Select-Object -First 1
        if ($next) {
          $currFolder = $next.GetFolder
        } else {
          $currFolder = $null
        }
      }
    }
  }
  
  if ($currFolder) {
    $items = @()
    foreach ($sub in $currFolder.Items()) {
      $items += [PSCustomObject]@{
        name = $sub.Name
        path = "$($found.Name)\$(if ($SubPath) { "$SubPath\" } else { '' })$($sub.Name)"
        type = $(if ($sub.IsFolder) { "folder" } else { "file" })
        size = $(if ($sub.Size) { $sub.Size } else { 0 })
        isPortable = $true
      }
    }
    if ($items.Count -gt 0) {
      $items | ConvertTo-Json -Compress
    } else {
      Write-Output "[]"
    }
  } else {
    Write-Output "[]"
  }
  exit 0
}
