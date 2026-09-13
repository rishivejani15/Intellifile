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
    $isDriveLetter = $item.Path -match '^[A-Za-z]:\\?$'
    if (-not $isDriveLetter -and ($item.Type -like "*Portable*" -or $item.Type -like "*Media*" -or $item.Type -like "*Phone*" -or $item.Type -like "*MTP*" -or $item.Type -like "*WPD*" -or $item.Type -like "*Camera*" -or $item.Type -like "*Mobile*" -or $item.Path -like "::{*" -or $item.Path -like "\\\?*" -or (-not $item.IsFileSystem -and -not [string]::IsNullOrWhiteSpace($item.Name)))) {
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
    $json = $devices | ConvertTo-Json -Compress
    if ($devices.Count -eq 1 -and -not $json.StartsWith("[")) {
      $json = "[$json]"
    }
    Write-Output $json
  } else {
    Write-Output "[]"
  }
  exit 0
}

if ($Action -eq "list-subitems") {
  $cleanTarget = if ($TargetName) { $TargetName.TrimEnd('\', '/') } else { '' }
  $found = $thisPC.Items() | Where-Object { $_.Name.TrimEnd('\', '/') -eq $cleanTarget -or $_.Path.TrimEnd('\', '/') -eq $cleanTarget } | Select-Object -First 1
  if (-not $found) {
    Write-Output "[]"
    exit 0
  }
  
  $currFolder = $found.GetFolder
  if ($SubPath) {
    $cleanSub = $SubPath.Trim('\', '/')
    $parts = $cleanSub.Split('\', [System.StringSplitOptions]::RemoveEmptyEntries)
    foreach ($part in $parts) {
      if ($currFolder) {
        $next = $null
        try { $next = $currFolder.ParseName($part) } catch {}
        if (-not $next) {
          $next = $currFolder.Items() | Where-Object { $_.Name -eq $part } | Select-Object -First 1
        }
        if ($next) {
          $currFolder = $next.GetFolder
        } else {
          $currFolder = $null
        }
      }
    }
  }
  
  if ($currFolder) {
    $subItemsList = @($currFolder.Items())
    $items = @(
      foreach ($sub in $subItemsList) {
        if (-not [string]::IsNullOrWhiteSpace($sub.Name)) {
          $isFolder = [bool]$sub.IsFolder
          [PSCustomObject]@{
            name = $sub.Name
            path = "$($found.Name)\$(if ($SubPath) { "$($SubPath.TrimEnd('\', '/'))\" } else { '' })$($sub.Name)"
            type = $(if ($isFolder) { "folder" } else { "file" })
            size = $(if ($sub.Size) { $sub.Size } else { 0 })
            isPortable = $false
          }
        }
      }
    )
    if ($items.Count -gt 0) {
      $json = $items | ConvertTo-Json -Compress
      if ($items.Count -eq 1 -and -not $json.StartsWith("[")) {
        $json = "[$json]"
      }
      Write-Output $json
    } else {
      Write-Output "[]"
    }
  } else {
    Write-Output "[]"
  }
  exit 0
}

if ($Action -eq "open-item") {
  $cleanTarget = if ($TargetName) { $TargetName.TrimEnd('\', '/') } else { '' }
  $found = $thisPC.Items() | Where-Object { $_.Name.TrimEnd('\', '/') -eq $cleanTarget -or $_.Path.TrimEnd('\', '/') -eq $cleanTarget } | Select-Object -First 1
  if ($found) {
    $curr = $found
    if ($SubPath) {
      $cleanSub = $SubPath.Trim('\', '/')
      $parts = $cleanSub.Split('\', [System.StringSplitOptions]::RemoveEmptyEntries)
      foreach ($part in $parts) {
        $f = $curr.GetFolder
        if ($f) {
          $next = $null
          try { $next = $f.ParseName($part) } catch {}
          if (-not $next) {
            $next = $f.Items() | Where-Object { $_.Name -eq $part } | Select-Object -First 1
          }
          $curr = $next
        }
      }
    }
    if ($curr) {
      $curr.InvokeVerb("open")
      Write-Output "{\"success\":true}"
      exit 0
    }
  }
  Write-Output "{\"success\":false,\"error\":\"Item not found\"}"
  exit 0
}
