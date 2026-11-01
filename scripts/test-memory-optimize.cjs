const { execFile } = require('child_process');
const ps = `
$sig = '[DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr hProcess);'
Add-Type -MemberDefinition $sig -Name Kernel -Namespace Win32 | Out-Null
$before = [Math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024)
Get-Process | ForEach-Object { try { [Win32.Kernel]::EmptyWorkingSet($_.Handle) } catch {} }
Start-Sleep -Milliseconds 500
$after = [Math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024)
$after - $before
`;
const b64 = Buffer.from(ps, 'utf16le').toString('base64');
execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64], { timeout: 12000 }, (err, stdout, stderr) => {
  console.log('err:', err ? err.message.split('\n')[0] : 'none');
  console.log('freed MB:', (stdout || '').trim());
  process.exit(0);
});
