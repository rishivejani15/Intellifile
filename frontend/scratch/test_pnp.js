const { execSync } = require('child_process');

try {
  const psCmd = `Get-PnpDevice -PresentOnly | Where-Object { $_.Class -eq 'PortableDevice' -or $_.Class -eq 'WPD' } | Select-Object FriendlyName, InstanceId, Status, Class | ConvertTo-Json`;
  const out = execSync(`powershell -NoProfile -Command "${psCmd}"`, { encoding: 'utf8' });
  console.log('PnP Portable Devices:');
  console.log(out);
} catch (e) {
  console.error('Error:', e.message);
}
